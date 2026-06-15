mod audio;
mod commands;
mod config;
mod history;
mod hotkey;
mod inject;
mod model_manager;
mod state;
pub mod stt;

use commands::AppState;
use hotkey::Action as HkAction;
use state::{Event as SmEvent, State};
use std::sync::Mutex;
use std::time::Instant;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Advance the state machine and emit the new state to the overlay.
fn transition(app: &tauri::AppHandle, ev: SmEvent) -> State {
    let app_state = app.state::<AppState>();
    let mut machine = app_state.machine.lock().unwrap();
    *machine = state::next(*machine, ev);
    let label = state::label(*machine);
    let _ = app.emit("state", serde_json::json!({ "state": label }));
    *machine
}

/// Start recording and show the overlay. Returns `true` if recording actually
/// began; `false` if the app was busy (e.g. still transcribing) or the device
/// failed, so the caller can reset the gesture detector.
fn start_recording(app: &tauri::AppHandle) -> bool {
    let new_state = transition(app, SmEvent::HotkeyPressed);
    if new_state != State::Recording {
        return false; // stray press while busy
    }
    let app_state = app.state::<AppState>();
    let device = app_state.config.lock().unwrap().mic_device.clone();
    match audio::Recorder::start(device.as_deref()) {
        Ok(rec) => {
            *app_state.recorder.lock().unwrap() = Some(rec);
            if let Some(w) = app.get_webview_window("overlay") {
                let _ = w.show();
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
fn stop_and_insert(app: &tauri::AppHandle) {
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
            hide_overlay_after_error(&app);
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
                        if let Some(w) = app.get_webview_window("overlay") {
                            let _ = w.hide();
                        }
                    }
                    Err(e) => {
                        eprintln!("inject failed: {e}");
                        let _ = app.emit("error", serde_json::json!({ "message": e }));
                        transition(&app, SmEvent::InjectionDone); // -> Idle
                        hide_overlay_after_error(&app);
                    }
                }
            }
            Err(e) => {
                eprintln!("transcribe failed: {e}");
                let _ = app.emit("error", serde_json::json!({ "message": e }));
                transition(&app, SmEvent::Error); // -> Idle
                hide_overlay_after_error(&app);
            }
        }
    });
}

/// Keep the overlay on screen briefly so the user can read the error toast it
/// just received, then hide it. Runs on the calling (already background) thread.
fn hide_overlay_after_error(app: &tauri::AppHandle) {
    std::thread::sleep(std::time::Duration::from_secs(4));
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.hide();
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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

            // Tray with a Settings + Quit menu.
            let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings_item, &quit_item])?;
            // build() registers a clone of the TrayIcon in the App's resource
            // table (manager.tray.icons), so the icon persists for the app's
            // lifetime even though the local handle is dropped here.
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "settings" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
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
