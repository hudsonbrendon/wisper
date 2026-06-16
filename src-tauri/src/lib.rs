mod audio;
mod commands;
mod config;
mod history;
mod hotkey;
mod inject;
mod model_manager;
mod overlay;
mod state;
pub mod stt;

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
        let language = app
            .state::<AppState>()
            .config
            .lock()
            .unwrap()
            .language
            .clone();
        let method = app.state::<AppState>().config.lock().unwrap().inject_method;

        let rms = audio::rms_level(&samples);

        // Guard against empty/too-short captures (e.g. a quick tap): Whisper
        // errors on an empty buffer. Require ~0.1s of audio (1600 @ 16kHz).
        if samples.len() < 1600 {
            eprintln!("no audio captured ({} samples)", samples.len());
            let _ = app.emit(
                "error",
                serde_json::json!({
                    "message": "No audio captured — hold the hotkey while you speak."
                }),
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
            let _ = app.emit(
                "error",
                serde_json::json!({
                    "message": "No audio detected — check OpenWispr's Microphone permission in System Settings → Privacy & Security → Microphone."
                }),
            );
            transition(&app, SmEvent::Error); // -> Idle
            return;
        }

        let text = {
            let app_state = app.state::<AppState>();
            let guard = app_state.transcriber.lock().unwrap();
            match guard.as_ref() {
                Some(t) => t.transcribe(&samples, &language),
                None => Err("no model loaded; download one in Settings".to_string()),
            }
        };

        match text {
            Ok(text) => {
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
                match inject::insert(&text, method) {
                    Ok(()) => {
                        transition(&app, SmEvent::InjectionDone); // -> Idle
                    }
                    Err(e) => {
                        eprintln!("inject failed: {e}");
                        let _ = app.emit("error", serde_json::json!({ "message": e }));
                        transition(&app, SmEvent::InjectionDone); // -> Idle
                    }
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

/// Convert the overlay window to a non-activating NSPanel (macOS only). The
/// NonActivatingPanel style mask (1 << 7) lets it receive clicks without
/// activating the app, so the previously-focused app stays frontmost and
/// injection still lands there. Best-effort: logs and continues on failure.
#[cfg(target_os = "macos")]
fn convert_overlay_to_panel(app: &tauri::AppHandle) {
    use tauri_nspanel::WebviewWindowExt;
    if let Some(overlay) = app.get_webview_window("overlay") {
        match overlay.to_panel() {
            Ok(panel) => panel.set_style_mask(1 << 7),
            Err(e) => eprintln!("overlay panel conversion failed: {e:?}"),
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn convert_overlay_to_panel(_app: &tauri::AppHandle) {}

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
                .unwrap_or(tauri::PhysicalSize::new(360, 72));
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

/// Pill window height (logical px) when collapsed vs. expanded for the language
/// menu. The menu is HTML *inside* the native window, so the window itself must
/// be tall enough to draw it — otherwise the OS clips the dropdown.
const PILL_WIDTH: f64 = 360.0;
const PILL_HEIGHT_COLLAPSED: f64 = 72.0;
const PILL_HEIGHT_EXPANDED: f64 = 340.0;

/// Grow the pill upward (menu open) or shrink it back (menu closed), keeping its
/// bottom edge anchored bottom-center so the pill itself does not move.
pub(crate) fn set_overlay_expanded(app: &tauri::AppHandle, expanded: bool) {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let h = if expanded {
            PILL_HEIGHT_EXPANDED
        } else {
            PILL_HEIGHT_COLLAPSED
        };
        let _ = overlay.set_size(tauri::LogicalSize::new(PILL_WIDTH, h));
        let monitor = overlay
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| overlay.primary_monitor().ok().flatten());
        if let Some(mon) = monitor {
            // bottom_center works in physical px; convert the logical size.
            let sf = overlay.scale_factor().unwrap_or(1.0);
            let win = (
                (PILL_WIDTH * sf).round() as u32,
                (h * sf).round() as u32,
            );
            let pos = mon.position();
            let size = mon.size();
            let (x, y) =
                overlay::bottom_center((pos.x, pos.y), (size.width, size.height), win, 90);
            let _ = overlay.set_position(tauri::PhysicalPosition::new(x, y));
        }
    }
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
    gs.on_shortcut(accel, move |app, _shortcut, event| match event.state() {
        ShortcutState::Pressed => on_shortcut(app, true),
        ShortcutState::Released => on_shortcut(app, false),
    })
    .map_err(|e| format!("register hotkey '{accel}': {e}"))
}

/// Handle a raw global-shortcut event through the gesture controller.
fn on_shortcut(app: &tauri::AppHandle, pressed: bool) {
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

/// Build the tray menu: Home, Check for Updates, Paste Last Transcription, a
/// Microphone submenu (one checkable entry per input device, the active one
/// checked), and Quit. Rebuilt whenever the mic selection changes so the check
/// marks stay accurate.
fn build_tray_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let home = MenuItem::with_id(app, "home", "Home", true, None::<&str>)?;
    let updates =
        MenuItem::with_id(app, "check_updates", "Check for Updates", true, None::<&str>)?;
    let paste =
        MenuItem::with_id(app, "paste_last", "Paste Last Transcription", true, None::<&str>)?;

    // Microphone submenu. Id "mic:" is the system default; "mic:<name>" a device.
    let current = app.state::<AppState>().config.lock().unwrap().mic_device.clone();
    let default_item =
        CheckMenuItem::with_id(app, "mic:", "System Default", true, current.is_none(), None::<&str>)?;
    let device_items: Vec<CheckMenuItem<tauri::Wry>> = audio::list_input_devices()
        .into_iter()
        .map(|dev| {
            let checked = current.as_deref() == Some(dev.as_str());
            CheckMenuItem::with_id(app, format!("mic:{dev}"), &dev, true, checked, None::<&str>)
        })
        .collect::<tauri::Result<_>>()?;
    let mut mic_refs: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&default_item];
    mic_refs.extend(device_items.iter().map(|i| i as &dyn IsMenuItem<tauri::Wry>));
    let microphone = Submenu::with_items(app, "Microphone", true, &mic_refs)?;

    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit OpenWispr", true, None::<&str>)?;

    Menu::with_items(app, &[&home, &updates, &paste, &microphone, &sep, &quit])
}

/// Re-inject the most recent transcription into the focused app. Runs on a short
/// delay so the menu closes and focus returns to the previously-focused app.
fn paste_last_transcription(app: &tauri::AppHandle) {
    let (data_dir, method) = {
        let st = app.state::<AppState>();
        let method = st.config.lock().unwrap().inject_method;
        (st.data_dir.clone(), method)
    };
    let Some(entry) = history::read_all(&data_dir).into_iter().next() else {
        let _ = app.emit("error", serde_json::json!({ "message": "No transcription yet." }));
        return;
    };
    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        if let Err(e) = inject::insert(&entry.text, method) {
            let _ = app2.emit("error", serde_json::json!({ "message": e }));
        }
    });
}

/// Apply a Microphone submenu selection (empty = system default): persist it and
/// rebuild the tray menu so the check marks reflect the new choice.
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

            // Ask for Accessibility trust up front. This pops the system dialog
            // when ungranted and, crucially, re-registers the current binary in
            // TCC — recovering from a stale grant left behind by a prior build.
            inject::prompt_accessibility_on_startup();

            // Trigger the Microphone permission prompt early (off the UI thread)
            // so capture works on the first dictation instead of recording
            // silence while the dialog is still up.
            std::thread::spawn(audio::prompt_microphone_access);

            // Resolve OS dirs and load config.
            let config_dir = handle.path().app_config_dir().expect("config dir");
            let data_dir = handle.path().app_data_dir().expect("data dir");
            let cfg = config::load(&config_dir);

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
            let tray_icon =
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
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

            // Register the hotkey. Press/release are fed through the gesture
            // controller, which supports both hold-to-talk and double-tap
            // hands-free recording.
            register_hotkey(&handle, &hotkey_accel)
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;

            // Closing the main window hides it instead of quitting — the app
            // keeps running in the tray. Only the tray's Quit item exits.
            if let Some(main) = app.get_webview_window("main") {
                let main_for_close = main.clone();
                main.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = main_for_close.hide();
                    }
                });
            }

            // Pill: make the overlay a non-activating panel, place it
            // bottom-center, and keep it on screen for the app's lifetime.
            convert_overlay_to_panel(&handle);
            place_and_show_overlay(&handle);

            // Hide the Dock icon if the user chose menu-bar-only.
            let show_in_dock = handle.state::<AppState>().config.lock().unwrap().show_in_dock;
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
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // Keep the app alive in the tray when windows close. `code.is_none()`
            // means the exit came from closing windows; an explicit `app.exit(n)`
            // (the tray Quit item) carries `Some(n)` and is allowed through.
            if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
