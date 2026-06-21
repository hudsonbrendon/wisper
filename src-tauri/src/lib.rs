mod audio;
mod commands;
mod config;
mod history;
mod hotkey;
mod inject;
mod meeting;
mod model_manager;
mod meetings;
#[cfg(target_os = "macos")]
mod modtap;
mod overlay;
mod state;
pub mod stt;
mod sysaudio;
mod text;
mod uitext;

use commands::AppState;
use hotkey::Action as HkAction;
use state::{Event as SmEvent, State};
use std::sync::Mutex;
use std::time::Instant;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Advance the state machine and emit the new state to the overlay.
fn transition(app: &tauri::AppHandle, ev: SmEvent) -> State {
    let app_state = app.state::<AppState>();
    let new = {
        let mut machine = app_state.machine.lock().unwrap();
        *machine = state::next(*machine, ev);
        *machine
    };
    let _ = app.emit("state", serde_json::json!({ "state": state::label(new) }));
    // When the pill isn't pinned, it only shows while busy (recording/etc.).
    let show_pill = app_state.config.lock().unwrap().show_pill;
    if let Some(w) = app.get_webview_window("overlay") {
        if show_pill || new != State::Idle {
            let _ = w.show();
        } else {
            let _ = w.hide();
        }
    }
    new
}

/// Start recording and show the overlay. Returns `true` if recording actually
/// began; `false` if the app was busy (e.g. still transcribing) or the device
/// failed, so the caller can reset the gesture detector.
pub(crate) fn start_recording(app: &tauri::AppHandle) -> bool {
    let new_state = transition(app, SmEvent::HotkeyPressed);
    if new_state != State::Recording {
        return false; // stray press while busy
    }
    let app_state = app.state::<AppState>();
    let (device, sounds, mute) = {
        let c = app_state.config.lock().unwrap();
        (c.mic_device.clone(), c.dictation_sounds, c.mute_music)
    };
    match audio::Recorder::start(device.as_deref()) {
        Ok(rec) => {
            *app_state.recorder.lock().unwrap() = Some(rec);
            if sounds {
                play_dictation_sound(true);
            }
            if mute {
                set_media_paused(true);
            }
            // Spawn a ticker that emits the live mic level while recording.
            let app2 = app.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(100));
                let st = app2.state::<AppState>();
                let guard = st.recorder.lock().unwrap();
                match guard.as_ref() {
                    Some(rec) => {
                        let _ =
                            app2.emit("audio_level", serde_json::json!({ "level": rec.level() }));
                    }
                    None => break,
                }
            });
        }
        Err(e) => {
            eprintln!("recorder start failed: {e}");
            let _ = app.emit("error", serde_json::json!({ "message": e }));
            transition(app, SmEvent::Error);
            return false;
        }
    }
    true
}

/// Stop recording, transcribe, inject, hide overlay.
pub(crate) fn stop_and_insert(app: &tauri::AppHandle) {
    let app_state = app.state::<AppState>();
    {
        let machine = app_state.machine.lock().unwrap();
        if *machine != State::Recording {
            return; // nothing to stop
        }
    }
    let recorder = app_state.recorder.lock().unwrap().take();
    let samples = match recorder {
        Some(rec) => rec.stop(),
        None => Vec::new(),
    };
    let (sounds, mute) = {
        let c = app_state.config.lock().unwrap();
        (c.dictation_sounds, c.mute_music)
    };
    if sounds {
        play_dictation_sound(false);
    }
    if mute {
        set_media_paused(false);
    }
    transition(app, SmEvent::HotkeyReleased); // -> Transcribing

    let app = app.clone();
    // Whisper is CPU-heavy and blocking; run off the UI thread.
    std::thread::spawn(move || {
        let (language, method, prompt, replacements, ui_lang) = {
            let st = app.state::<AppState>();
            let c = st.config.lock().unwrap();
            (
                c.language.clone(),
                c.inject_method,
                text::dictionary_prompt(&c.dictionary),
                c.replacements.clone(),
                c.ui_language.clone(),
            )
        };

        let rms = audio::rms_level(&samples);

        // Guard against empty/too-short captures (e.g. a quick tap): Whisper
        // errors on an empty buffer. Require ~0.1s of audio (1600 @ 16kHz).
        if samples.len() < 1600 {
            eprintln!("no audio captured ({} samples)", samples.len());
            let _ = app.emit(
                "error",
                serde_json::json!({ "message": uitext::t(&ui_lang, "err_no_audio") }),
            );
            transition(&app, SmEvent::Error); // -> Idle
            return;
        }

        // The buffer is long enough but near-silent: almost always the macOS
        // Microphone permission is missing/stale (the OS hands us zeros), which
        // otherwise makes Whisper hallucinate a stray phrase. Tell the user the
        // real cause instead of inserting garbage.
        if rms < 0.0008 {
            eprintln!("near-silent capture (rms={rms:.5}) — likely no mic permission");
            #[cfg(target_os = "macos")]
            let hint = uitext::t(&ui_lang, "err_no_mic_mac");
            #[cfg(target_os = "windows")]
            let hint = uitext::t(&ui_lang, "err_no_mic_win");
            #[cfg(target_os = "linux")]
            let hint = uitext::t(&ui_lang, "err_no_mic_linux");
            let _ = app.emit("error", serde_json::json!({ "message": hint }));
            transition(&app, SmEvent::Error); // -> Idle
            return;
        }

        let text = {
            let app_state = app.state::<AppState>();
            let guard = app_state.transcriber.lock().unwrap();
            match guard.as_ref() {
                Some(t) => t.transcribe(&samples, &language, &prompt),
                None => Err(uitext::t(&ui_lang, "err_no_model")),
            }
        };

        match text {
            Ok(text) => {
                // Snippets / fixups before anything sees the transcript.
                let text = text::apply_replacements(&text, &replacements);
                let _ = app.emit("transcript", serde_json::json!({ "text": text }));

                // Record the dictation locally so Home/Insights have data to
                // show. Best-effort: capture (16 kHz mono → ms) and log on
                // failure, never block insertion.
                {
                    let words = text.split_whitespace().count();
                    let duration_ms = (samples.len() as u64) * 1000 / 16_000;
                    let ts_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    let entry = history::Entry {
                        ts_ms,
                        text: text.clone(),
                        words,
                        duration_ms,
                    };
                    let data_dir = app.state::<AppState>().data_dir.clone();
                    if let Err(e) = history::append(&data_dir, &entry) {
                        eprintln!("history append failed: {e}");
                    } else {
                        let _ = app.emit("history_changed", serde_json::json!({}));
                    }
                }

                transition(&app, SmEvent::TranscriptionDone); // -> Injecting
                                                              // enigo touches macOS Text Input Source APIs (TSM) that assert
                                                              // they run on the main thread — calling them from this worker
                                                              // thread hard-crashes with SIGTRAP on macOS 26+. Hop to the main
                                                              // thread for the actual injection (the heavy whisper work already
                                                              // ran off it above).
                let app_inj = app.clone();
                let text_inj = text.clone();
                let dispatched = app.run_on_main_thread(move || {
                    match inject::insert(&text_inj, method) {
                        Ok(()) => {}
                        Err(e) => {
                            eprintln!("inject failed: {e}");
                            let _ = app_inj.emit("error", serde_json::json!({ "message": e }));
                        }
                    }
                    transition(&app_inj, SmEvent::InjectionDone); // -> Idle
                                                                  // Re-showing the pill above grabbed the key window back; hand
                                                                  // it to the dictation target so a trailing Enter goes there.
                    return_key_to_target(&app_inj);
                });
                if dispatched.is_err() {
                    transition(&app, SmEvent::InjectionDone); // -> Idle (never stick)
                }
            }
            Err(e) => {
                eprintln!("transcribe failed: {e}");
                let _ = app.emit("error", serde_json::json!({ "message": e }));
                transition(&app, SmEvent::Error); // -> Idle
            }
        }
    });
}

/// Discard the in-progress take: drop the recorder (halting capture and
/// throwing away the buffer) and return to Idle without transcribing.
pub(crate) fn cancel_recording(app: &tauri::AppHandle) {
    {
        let app_state = app.state::<AppState>();
        let machine = app_state.machine.lock().unwrap();
        if *machine != State::Recording {
            return; // nothing to cancel
        }
    }
    // Dropping the recorder stops the stream; the level ticker sees `None` and exits.
    let _ = app.state::<AppState>().recorder.lock().unwrap().take();
    if app.state::<AppState>().config.lock().unwrap().mute_music {
        set_media_paused(false); // resume whatever we paused on record start
    }
    transition(app, SmEvent::Cancel); // -> Idle
}

/// Start a meeting recording and show the bubble. Returns an error string the
/// frontend surfaces (no model, no permission, unsupported OS, device busy).
pub(crate) fn start_meeting(app: &tauri::AppHandle) -> Result<(), String> {
    let st = app.state::<AppState>();
    if st.transcriber.lock().unwrap().is_none() {
        return Err("no_model".to_string());
    }
    if st.meeting.lock().unwrap().is_some() {
        return Err("already_recording".to_string());
    }
    let mic_device = st.config.lock().unwrap().mic_device.clone();
    let started_ms = now_ms();
    let rec = crate::meeting::MeetingRecorder::start(mic_device.as_deref(), started_ms)?;
    *st.meeting.lock().unwrap() = Some(rec);

    place_and_show_meeting_bubble(app);
    let _ = app.emit("meeting_state", serde_json::json!({ "state": "recording" }));

    // Live level ticker for the bubble meter.
    let app2 = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let st = app2.state::<AppState>();
        let guard = st.meeting.lock().unwrap();
        match guard.as_ref() {
            Some(rec) => {
                let _ = app2.emit("meeting_level", serde_json::json!({ "level": rec.level() }));
            }
            None => break,
        }
    });
    Ok(())
}

/// Stop the meeting, transcribe + save off the UI thread, hide the bubble, and
/// emit `meeting_saved` with the new id when done.
pub(crate) fn stop_meeting(app: &tauri::AppHandle) {
    let rec = match app.state::<AppState>().meeting.lock().unwrap().take() {
        Some(r) => r,
        None => return,
    };
    if let Some(w) = app.get_webview_window("meeting-bubble") {
        let _ = w.hide();
    }
    let _ = app.emit("meeting_state", serde_json::json!({ "state": "transcribing" }));

    let app = app.clone();
    std::thread::spawn(move || {
        let (language, prompt, data_dir) = {
            let st = app.state::<AppState>();
            let c = st.config.lock().unwrap();
            (
                c.language.clone(),
                text::dictionary_prompt(&c.dictionary),
                st.data_dir.clone(),
            )
        };
        let meeting = {
            let st = app.state::<AppState>();
            let guard = st.transcriber.lock().unwrap();
            match guard.as_ref() {
                Some(t) => rec.stop(t, &language, &prompt),
                None => {
                    let _ = app.emit("error", serde_json::json!({ "message": "no_model" }));
                    let _ = app.emit("meeting_state", serde_json::json!({ "state": "idle" }));
                    return;
                }
            }
        };
        if let Err(e) = meetings::save(&data_dir, &meeting) {
            eprintln!("meeting save failed: {e}");
        }
        let _ = app.emit("meeting_state", serde_json::json!({ "state": "idle" }));
        let _ = app.emit("meeting_saved", serde_json::json!({ "id": meeting.id }));
    });
}

/// Discard the in-progress meeting without transcribing.
pub(crate) fn cancel_meeting(app: &tauri::AppHandle) {
    if let Some(rec) = app.state::<AppState>().meeting.lock().unwrap().take() {
        rec.cancel();
    }
    if let Some(w) = app.get_webview_window("meeting-bubble") {
        let _ = w.hide();
    }
    let _ = app.emit("meeting_state", serde_json::json!({ "state": "idle" }));
}

/// Epoch milliseconds now.
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Place the meeting bubble at the top-center of the current monitor and show it.
fn place_and_show_meeting_bubble(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("meeting-bubble") {
        let monitor = win
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| win.primary_monitor().ok().flatten());
        if let Some(mon) = monitor {
            let pos = mon.position();
            let size = mon.size();
            let w = win.outer_size().unwrap_or(tauri::PhysicalSize::new(280, 64));
            let (x, y) = overlay::top_center(
                (pos.x, pos.y),
                (size.width, size.height),
                (w.width, w.height),
                24,
            );
            let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
        }
        let _ = win.show();
    }
}

/// Convert the overlay window to a non-activating NSPanel (macOS only). The
/// NonActivatingPanel style mask (1 << 7) lets it receive clicks without
/// activating the app, and `becomesKeyOnlyIfNeeded` keeps it from grabbing the
/// keyboard focus just by being shown — so the app the user dictated into stays
/// the key window and a follow-up Enter goes there, not to the pill. Best-effort.
#[cfg(target_os = "macos")]
fn convert_overlay_to_panel(app: &tauri::AppHandle) {
    use tauri_nspanel::WebviewWindowExt;
    if let Some(overlay) = app.get_webview_window("overlay") {
        match overlay.to_panel() {
            Ok(panel) => {
                panel.set_style_mask(1 << 7);
                panel.set_becomes_key_only_if_needed(true);
            }
            Err(e) => eprintln!("overlay panel conversion failed: {e:?}"),
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn convert_overlay_to_panel(_app: &tauri::AppHandle) {}

/// Hand the key window back to the app the user dictated into, after injection.
///
/// The overlay is a non-activating `NSPanel`, but `tauri-nspanel` hard-codes
/// `canBecomeKeyWindow = YES`, so every time the pill is shown it grabs the key
/// window. The target app stays *frontmost* (we paste straight to its PID), yet
/// the pill owns the keyboard — so a trailing Enter goes to the pill and the
/// user has to click the field again. Ordering the panel out resigns its key
/// status, which AppKit hands to the frontmost app (the dictation target). When
/// the pill is pinned we re-show it with `orderFrontRegardless`, which makes it
/// visible again *without* taking the key window back. Must run on the main
/// thread (AppKit). Best-effort.
#[cfg(target_os = "macos")]
fn return_key_to_target(app: &tauri::AppHandle) {
    use objc2_app_kit::NSWindow;
    let pinned = app.state::<AppState>().config.lock().unwrap().show_pill;
    if let Some(overlay) = app.get_webview_window("overlay") {
        if let Ok(ptr) = overlay.ns_window() {
            let win: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
            win.orderOut(None);
            if pinned {
                win.orderFrontRegardless();
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn return_key_to_target(_app: &tauri::AppHandle) {}

/// Anchor the pill bottom-center above the Dock/taskbar, then show it.
fn place_and_show_overlay(app: &tauri::AppHandle) {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let monitor = overlay
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| overlay.primary_monitor().ok().flatten());
        if let Some(mon) = monitor {
            let pos = mon.position();
            let size = mon.size();
            let win = overlay
                .outer_size()
                .unwrap_or(tauri::PhysicalSize::new(360, 340));
            let (x, y) = overlay::bottom_center(
                (pos.x, pos.y),
                (size.width, size.height),
                (win.width, win.height),
                90,
            );
            let _ = overlay.set_position(tauri::PhysicalPosition::new(x, y));
        }
        // Only pin it on screen if the user wants the pill always visible;
        // otherwise it stays hidden until dictation starts (see `transition`).
        if app.state::<AppState>().config.lock().unwrap().show_pill {
            let _ = overlay.show();
        } else {
            let _ = overlay.hide();
        }
    }
}

// The overlay is a single fixed-size native window (see tauri.conf.json): the
// pill sits at the bottom edge (CSS `items-end`) and the language menu expands
// *upward* into the space already reserved above it. The window never resizes
// or repositions while open. This avoids the cross-platform breakage of the old
// grow-and-reanchor approach — on Wayland an app can't set its own window
// position, so growing the window made the pill jump and the list render
// mid-grow (it could also flicker on Windows). A fixed window has nothing to
// jump.

/// Logical-px band at the bottom of the window that the collapsed pill occupies.
/// Only cursor hits inside this band (or anywhere, when the menu is open) keep
/// the window interactive; elsewhere it is click-through. Generous so the pill's
/// hit target is comfortable.
const PILL_INTERACTIVE_BAND: f64 = 104.0;

/// Whether the language menu is open. Drives the click-through hit test: open →
/// the whole window is interactive (so clicking outside the menu can dismiss it);
/// closed → only the pill band is.
static PILL_EXPANDED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Current `ignore_cursor_events` state, so the poller only calls the (main-
/// thread) setter when it actually changes. Starts true: a fresh overlay is
/// fully click-through until the cursor reaches the pill.
static OVERLAY_IGNORING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

/// Mark the menu open/closed and re-evaluate click-through immediately so the
/// menu is interactive the instant it appears (rather than on the next poll).
pub(crate) fn set_overlay_expanded(app: &tauri::AppHandle, expanded: bool) {
    PILL_EXPANDED.store(expanded, std::sync::atomic::Ordering::Relaxed);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || update_overlay_clickthrough(&handle));
}

/// Is the global cursor over the currently-interactive region of the overlay?
/// That region is the whole window while the menu is open, else the bottom pill
/// band. All coordinates are physical px.
fn cursor_over_pill(app: &tauri::AppHandle) -> bool {
    let Some(overlay) = app.get_webview_window("overlay") else {
        return false;
    };
    let (Ok(pos), Ok(size)) = (overlay.outer_position(), overlay.outer_size()) else {
        return false;
    };
    let Ok(cur) = app.cursor_position() else {
        return false;
    };
    let sf = overlay.scale_factor().unwrap_or(1.0);
    let band = if PILL_EXPANDED.load(std::sync::atomic::Ordering::Relaxed) {
        size.height as f64
    } else {
        PILL_INTERACTIVE_BAND * sf
    };
    overlay::point_in_band(
        (cur.x, cur.y),
        (pos.x as f64, pos.y as f64),
        (size.width as f64, size.height as f64),
        band,
    )
}

/// Toggle the overlay between click-through and interactive based on where the
/// cursor is. Cheap no-op when the desired state already matches. Must run on
/// the main thread (it touches the native window).
fn update_overlay_clickthrough(app: &tauri::AppHandle) {
    let Some(overlay) = app.get_webview_window("overlay") else {
        return;
    };
    // A hidden pill never needs to capture clicks.
    let visible = overlay.is_visible().unwrap_or(false);
    let want_ignore = !visible || !cursor_over_pill(app);
    if OVERLAY_IGNORING.swap(want_ignore, std::sync::atomic::Ordering::Relaxed) != want_ignore {
        let _ = overlay.set_ignore_cursor_events(want_ignore);
    }
}

/// Poll the cursor a few times a second and keep the overlay's click-through
/// state in sync. Polling (rather than window cursor events) is required because
/// while the window is click-through it receives no events at all, so it can't
/// notice the cursor arriving over the pill on its own.
fn start_overlay_clickthrough_poller(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(60));
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || update_overlay_clickthrough(&handle));
    });
}

/// Carry out a gesture [`HkAction`] against the audio pipeline.
fn dispatch(app: &tauri::AppHandle, action: HkAction) {
    match action {
        HkAction::None => {}
        HkAction::StartRecording => {
            if !start_recording(app) {
                // App was busy / device failed: keep the gesture detector in
                // sync with reality so the next press starts fresh.
                app.state::<AppState>().hotkey.lock().unwrap().reset();
            }
        }
        HkAction::StopAndInsert => stop_and_insert(app),
        HkAction::ArmTapTimeout => {
            // Recording keeps running. After the double-tap window, ask the
            // controller whether this was a lone tap (→ stop) or got superseded
            // by a second press (→ no-op). The token guards against the latter.
            let token = {
                let st = app.state::<AppState>();
                let c = st.hotkey.lock().unwrap();
                // on_release already bumped the generation; read it back.
                c.arm_token()
            };
            let app2 = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(hotkey::DOUBLE_TAP_WINDOW);
                let next = app2
                    .state::<AppState>()
                    .hotkey
                    .lock()
                    .unwrap()
                    .on_tap_timeout(token);
                dispatch(&app2, next);
            });
        }
    }
}

/// (Re)register the global hotkey, replacing any previously registered one.
/// Called at startup and whenever the hotkey changes in Settings, so a new
/// binding takes effect immediately without restarting the app.
pub(crate) fn register_hotkey(app: &tauri::AppHandle, accel: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    // A lone modifier (e.g. Option) can't be a global shortcut — drive it from
    // the flagsChanged event tap instead (macOS only).
    #[cfg(target_os = "macos")]
    if let Some(flag) = modtap::modifier_flag(accel) {
        modtap::set_modifier(Some(flag));
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    modtap::set_modifier(None);

    gs.on_shortcut(accel, move |app, _shortcut, event| match event.state() {
        ShortcutState::Pressed => on_shortcut(app, true),
        ShortcutState::Released => on_shortcut(app, false),
    })
    .map_err(|e| format!("register hotkey '{accel}': {e}"))
}

/// Handle a raw global-shortcut / modifier-tap event through the gesture
/// controller.
pub(crate) fn on_shortcut(app: &tauri::AppHandle, pressed: bool) {
    let action = {
        let st = app.state::<AppState>();
        let mut c = st.hotkey.lock().unwrap();
        if pressed {
            c.on_press(Instant::now())
        } else {
            // Discard the arm token here; dispatch re-reads it via arm_token().
            c.on_release(Instant::now()).0
        }
    };
    dispatch(app, action);
}

/// Reset the macOS Microphone AND Accessibility TCC grants when the app binary
/// has changed since last launch (a fresh install or update). Without a paid
/// Apple Developer identity the signature isn't stable across builds, so the OS
/// keys each grant on the code hash and leaves a stale "granted" record for the
/// previous build: microphone capture silently yields silence, and synthesized
/// keystrokes (text injection) are silently dropped — so audio transcribes but
/// the text never lands. Resetting both forces the startup prompts to
/// re-register THIS binary and show the dialogs, so the user re-allows once per
/// update. Runs at most once per build (guarded by a marker file). macOS only.
#[cfg(target_os = "macos")]
fn heal_permissions_if_updated(data_dir: &std::path::Path) {
    let marker = data_dir.join("mic_build_marker");
    let current = std::env::current_exe()
        .ok()
        .and_then(|p| std::fs::metadata(p).ok())
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default();
    if current.is_empty() {
        return;
    }
    let previous = std::fs::read_to_string(&marker).unwrap_or_default();
    if current == previous {
        return; // same build — leave the existing grants alone
    }
    for service in ["Microphone", "Accessibility"] {
        let _ = std::process::Command::new("tccutil")
            .args(["reset", service, "chat.wisper"])
            .status();
    }
    let _ = std::fs::create_dir_all(data_dir);
    let _ = std::fs::write(&marker, current);
}

#[cfg(not(target_os = "macos"))]
fn heal_permissions_if_updated(_data_dir: &std::path::Path) {}

/// Play the dictation start/stop chime (macOS only; best-effort).
fn play_dictation_sound(start: bool) {
    #[cfg(target_os = "macos")]
    {
        let sound = if start { "Tink" } else { "Pop" };
        let _ = std::process::Command::new("afplay")
            .arg(format!("/System/Library/Sounds/{sound}.aiff"))
            .spawn();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = start;
}

/// Pause or resume Spotify / Apple Music while dictating (macOS only,
/// best-effort — a no-op if the app isn't running).
fn set_media_paused(paused: bool) {
    #[cfg(target_os = "macos")]
    {
        let action = if paused { "pause" } else { "play" };
        for media_app in ["Spotify", "Music"] {
            let script = format!(
                "tell application \"System Events\" to if exists (processes whose name is \"{media_app}\") then tell application \"{media_app}\" to {action}"
            );
            let _ = std::process::Command::new("osascript")
                .arg("-e")
                .arg(script)
                .spawn();
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = paused;
}

/// Re-apply the pill's visibility from config + current state. Called after a
/// settings change so toggling "show pill" takes effect immediately.
pub(crate) fn refresh_overlay_visibility(app: &tauri::AppHandle) {
    let st = app.state::<AppState>();
    let show_pill = st.config.lock().unwrap().show_pill;
    let busy = *st.machine.lock().unwrap() != State::Idle;
    if let Some(w) = app.get_webview_window("overlay") {
        if show_pill || busy {
            let _ = w.show();
        } else {
            let _ = w.hide();
        }
    }
}

/// Show or hide the Dock icon (macOS activation policy). No-op elsewhere.
pub(crate) fn apply_dock_visibility(app: &tauri::AppHandle, show: bool) {
    #[cfg(target_os = "macos")]
    {
        let policy = if show {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };
        let _ = app.set_activation_policy(policy);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, show);
    }
}

// macOS tints the tray icon to the menu bar automatically via the template
// image (`icon_as_template`), so the glyph is always the inverse of the bar.
// Linux/Windows don't template, so we mirror that behavior by hand: pick a
// black or white version of the glyph to contrast the status bar, and swap it
// whenever the OS light/dark theme changes.
#[cfg(not(target_os = "macos"))]
fn tray_icon_for_theme(theme: tauri::Theme) -> tauri::Result<tauri::image::Image<'static>> {
    // Dark bar → white glyph; light bar → black glyph (both have the waveform
    // bars knocked out, so the bar shows through them either way).
    let bytes: &[u8] = match theme {
        tauri::Theme::Dark => include_bytes!("../icons/tray-light.png"),
        _ => include_bytes!("../icons/tray.png"),
    };
    tauri::image::Image::from_bytes(bytes)
}

/// Set the tray icon to match `theme`. No-op on macOS, where the template image
/// already auto-inverts to the menu bar.
#[allow(unused_variables)]
fn apply_tray_theme(app: &tauri::AppHandle, theme: tauri::Theme) {
    #[cfg(not(target_os = "macos"))]
    if let Some(tray) = app.tray_by_id("main") {
        if let Ok(icon) = tray_icon_for_theme(theme) {
            let _ = tray.set_icon(Some(icon));
        }
    }
}

/// The OS light/dark theme as reported by the main window (falls back to dark,
/// the common default for Linux panels and Windows taskbars).
fn current_os_theme(app: &tauri::AppHandle) -> tauri::Theme {
    app.get_webview_window("main")
        .and_then(|w| w.theme().ok())
        .unwrap_or(tauri::Theme::Dark)
}

/// Build the tray menu: Home, Check for Updates, Paste Last Transcription, a
/// Microphone submenu (one checkable entry per input device, the active one
/// checked), and Quit. Rebuilt whenever the mic selection changes so the check
/// marks stay accurate.
fn build_tray_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let (lang, current) = {
        let st = app.state::<AppState>();
        let c = st.config.lock().unwrap();
        (c.ui_language.clone(), c.mic_device.clone())
    };
    let tr = |key| uitext::t(&lang, key);

    let home = MenuItem::with_id(app, "home", tr("tray_home"), true, None::<&str>)?;
    let updates = MenuItem::with_id(app, "check_updates", tr("tray_updates"), true, None::<&str>)?;
    let paste = MenuItem::with_id(app, "paste_last", tr("tray_paste"), true, None::<&str>)?;

    // Microphone submenu. Id "mic:" is the system default; "mic:<name>" a device.
    let default_item = CheckMenuItem::with_id(
        app,
        "mic:",
        tr("tray_system_default"),
        true,
        current.is_none(),
        None::<&str>,
    )?;
    let device_items: Vec<CheckMenuItem<tauri::Wry>> = audio::list_input_devices()
        .into_iter()
        .map(|dev| {
            let checked = current.as_deref() == Some(dev.as_str());
            CheckMenuItem::with_id(app, format!("mic:{dev}"), &dev, true, checked, None::<&str>)
        })
        .collect::<tauri::Result<_>>()?;
    let mut mic_refs: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&default_item];
    mic_refs.extend(
        device_items
            .iter()
            .map(|i| i as &dyn IsMenuItem<tauri::Wry>),
    );
    let microphone = Submenu::with_items(app, tr("tray_microphone"), true, &mic_refs)?;

    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", tr("tray_quit"), true, None::<&str>)?;

    Menu::with_items(app, &[&home, &updates, &paste, &microphone, &sep, &quit])
}

/// Re-inject the most recent transcription into the focused app. Runs on a short
/// delay so the menu closes and focus returns to the previously-focused app.
fn paste_last_transcription(app: &tauri::AppHandle) {
    let (data_dir, method, ui_lang) = {
        let st = app.state::<AppState>();
        let c = st.config.lock().unwrap();
        (st.data_dir.clone(), c.inject_method, c.ui_language.clone())
    };
    let Some(entry) = history::read_all(&data_dir).into_iter().next() else {
        let _ = app.emit(
            "error",
            serde_json::json!({ "message": uitext::t(&ui_lang, "err_no_transcription") }),
        );
        return;
    };
    let app2 = app.clone();
    std::thread::spawn(move || {
        // Let the tray menu close and focus return to the target app first.
        std::thread::sleep(std::time::Duration::from_millis(300));
        // enigo must run on the main thread (TSM asserts it); hop there.
        let app3 = app2.clone();
        let _ = app2.run_on_main_thread(move || {
            if let Err(e) = inject::insert(&entry.text, method) {
                let _ = app3.emit("error", serde_json::json!({ "message": e }));
            }
        });
    });
}

/// Apply a Microphone submenu selection (empty = system default): persist it and
/// rebuild the tray menu so the check marks reflect the new choice.
/// Persist the interface language and rebuild the tray so its labels switch to
/// it immediately. Called from the frontend whenever the UI language changes.
#[tauri::command]
fn set_ui_language(app: tauri::AppHandle, lang: String) {
    {
        let st = app.state::<AppState>();
        let mut cfg = st.config.lock().unwrap();
        cfg.ui_language = lang;
        let _ = config::save(&st.config_dir, &cfg);
    }
    if let Some(tray) = app.tray_by_id("main") {
        if let Ok(menu) = build_tray_menu(&app) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

fn set_tray_mic_device(app: &tauri::AppHandle, device: &str) {
    {
        let st = app.state::<AppState>();
        let mut cfg = st.config.lock().unwrap();
        cfg.mic_device = if device.is_empty() {
            None
        } else {
            Some(device.to_string())
        };
        let _ = config::save(&st.config_dir, &cfg);
    }
    if let Some(tray) = app.tray_by_id("main") {
        if let Ok(menu) = build_tray_menu(app) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // Must be the first plugin: a second launch hands its args to this
        // callback and exits, so only one instance ever holds the global
        // hotkey (no stale instance keeping an old binding alive).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));

    // macOS only: convert the overlay into a non-activating NSPanel so clicking
    // the pill never steals focus from the target app. Other platforms (which
    // have no `tauri-nspanel`) need no equivalent — the pill is a normal window.
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .setup(|app| {
            let handle = app.handle().clone();

            // Resolve OS dirs and load config.
            let config_dir = handle.path().app_config_dir().expect("config dir");
            let data_dir = handle.path().app_data_dir().expect("data dir");
            let cfg = config::load(&config_dir);

            // After an install/update the ad-hoc signature changes, so macOS
            // leaves BOTH the Microphone and Accessibility TCC grants stale —
            // capture returns silence and injected keystrokes are dropped (audio
            // transcribes but no text lands). Reset them on a changed binary
            // BEFORE re-prompting, so the prompts below register the new binary
            // cleanly and the user re-allows once per update.
            heal_permissions_if_updated(&data_dir);

            // Ask for Accessibility trust up front. This pops the system dialog
            // when ungranted and re-registers the current binary in TCC — so
            // injected text actually lands instead of being silently dropped.
            inject::prompt_accessibility_on_startup();

            // Start the lone-modifier hotkey tap (e.g. push-to-talk on Option).
            // No-op unless the configured hotkey is a single modifier.
            #[cfg(target_os = "macos")]
            modtap::start(handle.clone());

            // Trigger the Microphone permission prompt early (off the UI thread)
            // so capture works on the first dictation instead of recording
            // silence while the dialog is still up.
            std::thread::spawn(audio::prompt_microphone_access);

            // Load the configured model if it is already downloaded.
            let transcriber = model_manager::find(&cfg.model_id)
                .filter(|m| model_manager::is_downloaded(&data_dir, m))
                .and_then(|m| {
                    let path = model_manager::model_path(&data_dir, m);
                    stt::Transcriber::load(path.to_str()?).ok()
                });

            let hotkey_accel = cfg.hotkey.clone();

            app.manage(AppState {
                config: Mutex::new(cfg),
                machine: Mutex::new(State::Idle),
                transcriber: Mutex::new(transcriber),
                recorder: Mutex::new(None),
                meeting: Mutex::new(None),
                config_dir,
                data_dir,
                cancels: Mutex::new(std::collections::HashSet::new()),
                hotkey: Mutex::new(hotkey::Controller::new()),
            });

            // Tray menu: Home, updates, paste-last, Microphone submenu, Quit.
            let menu = build_tray_menu(&handle)?;
            // Monochrome speech-bubble tray glyph. `icon_as_template` makes macOS
            // tint it to match the menu bar (light/dark) and size it to the bar,
            // so it shows as the bubble silhouette — not a square app icon.
            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
            // `with_id("main")` lets us fetch the tray later (app.tray_by_id) to
            // swap the menu when the mic selection changes. build() registers a
            // clone in the App's resource table, so the icon persists for the
            // app's lifetime even though the local handle is dropped here.
            TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .icon_as_template(true)
                .menu(&menu)
                .on_menu_event(|app, event| {
                    let show_main = || {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    };
                    match event.id.as_ref() {
                        "home" => {
                            show_main();
                            let _ = app.emit("tray_navigate", "home");
                        }
                        "check_updates" => {
                            show_main();
                            let _ = app.emit("tray_check_updates", ());
                        }
                        "paste_last" => paste_last_transcription(app),
                        "quit" => app.exit(0),
                        other => {
                            if let Some(dev) = other.strip_prefix("mic:") {
                                set_tray_mic_device(app, dev);
                            }
                        }
                    }
                })
                .build(app)?;

            // Match the tray glyph to the current OS theme (no-op on macOS,
            // which templates the icon itself).
            apply_tray_theme(&handle, current_os_theme(&handle));

            // Register the hotkey. Press/release are fed through the gesture
            // controller, which supports both hold-to-talk and double-tap
            // hands-free recording.
            register_hotkey(&handle, &hotkey_accel)
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;

            // Closing the main window hides it instead of quitting — the app
            // keeps running in the tray. Only the tray's Quit item exits. We
            // also watch for OS light/dark changes here to re-tint the tray.
            if let Some(main) = app.get_webview_window("main") {
                let main_for_close = main.clone();
                let theme_handle = handle.clone();
                main.on_window_event(move |event| match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = main_for_close.hide();
                    }
                    tauri::WindowEvent::ThemeChanged(theme) => {
                        apply_tray_theme(&theme_handle, *theme);
                    }
                    _ => {}
                });
            }

            // Pill: make the overlay a non-activating panel, place it
            // bottom-center, and keep it on screen for the app's lifetime.
            convert_overlay_to_panel(&handle);
            place_and_show_overlay(&handle);
            // The pill window spans a tall transparent area (so the language
            // menu can open upward without resizing the window). Start it fully
            // click-through and let the poller make only the pill/menu region
            // interactive, so the empty space never eats clicks meant for the
            // app behind it.
            if let Some(overlay) = handle.get_webview_window("overlay") {
                let _ = overlay.set_ignore_cursor_events(true);
            }
            start_overlay_clickthrough_poller(&handle);

            // Hide the Dock icon if the user chose menu-bar-only.
            let show_in_dock = handle
                .state::<AppState>()
                .config
                .lock()
                .unwrap()
                .show_in_dock;
            apply_dock_visibility(&handle, show_in_dock);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::list_microphones,
            commands::list_models,
            commands::download_model,
            commands::cancel_download,
            commands::remove_model,
            commands::get_state,
            commands::get_history,
            commands::clear_history,
            commands::ui_start_recording,
            commands::ui_stop_and_insert,
            commands::ui_cancel_recording,
            commands::set_language,
            commands::set_pill_expanded,
            commands::set_launch_at_login,
            commands::get_launch_at_login,
            commands::reset_app,
            commands::get_permissions,
            commands::prompt_accessibility,
            commands::reset_microphone,
            commands::open_privacy_settings,
            commands::start_meeting,
            commands::stop_meeting,
            commands::cancel_meeting,
            commands::meeting_level,
            commands::get_meeting_state,
            commands::list_meetings,
            commands::get_meeting,
            commands::delete_meeting,
            commands::rename_meeting,
            commands::meeting_supported,
            commands::check_system_audio_permission,
            commands::request_system_audio_permission,
            commands::open_system_audio_settings,
            set_ui_language,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // Keep the app alive in the tray when windows close. `code.is_none()`
            // means the exit came from closing windows; an explicit `app.exit(n)`
            // (the tray Quit item) carries `Some(n)` and is allowed through.
            if let tauri::RunEvent::ExitRequested { code, ref api, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }

            // On macOS the Metal-backed Whisper build (ggml) registers a global
            // device whose static C++ destructor runs during the normal
            // `std::process::exit` (via `__cxa_finalize`). That destructor frees
            // Metal resource sets while a deferred init block may still be running
            // on a background queue, which trips `ggml_abort` and crashes on quit.
            // Skip the C runtime teardown entirely: `_exit` terminates immediately
            // and lets the OS reclaim GPU and memory. Config/history are persisted
            // synchronously on write, so there is nothing left to flush here.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Exit = event {
                unsafe { libc::_exit(0) };
            }
        });
}
