mod audio;
mod commands;
mod config;
mod inject;
mod model_manager;
mod state;
pub mod stt;

use commands::AppState;
use state::{Event as SmEvent, State};
use std::sync::Mutex;
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

/// Called on hotkey press: start recording, show overlay.
fn on_press(app: &tauri::AppHandle) {
    let new_state = transition(app, SmEvent::HotkeyPressed);
    if new_state != State::Recording {
        return; // stray press while busy
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
        }
    }
}

/// Called on hotkey release: stop recording, transcribe, inject, hide overlay.
fn on_release(app: &tauri::AppHandle) {
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
                transition(&app, SmEvent::TranscriptionDone); // -> Injecting
                if let Err(e) = inject::insert(&text, method) {
                    eprintln!("inject failed: {e}");
                    let _ = app.emit("error", serde_json::json!({ "message": e }));
                }
                transition(&app, SmEvent::InjectionDone); // -> Idle
            }
            Err(e) => {
                eprintln!("transcribe failed: {e}");
                let _ = app.emit("error", serde_json::json!({ "message": e }));
                transition(&app, SmEvent::Error); // -> Idle
            }
        }
        if let Some(w) = app.get_webview_window("overlay") {
            let _ = w.hide();
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();

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

            let hotkey = cfg.hotkey.clone();

            app.manage(AppState {
                config: Mutex::new(cfg),
                machine: Mutex::new(State::Idle),
                transcriber: Mutex::new(transcriber),
                recorder: Mutex::new(None),
                config_dir,
                data_dir,
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

            // Register the push-to-talk hotkey with press/release handling.
            let gs = app.global_shortcut();
            gs.on_shortcut(hotkey.as_str(), move |app, _shortcut, event| {
                match event.state() {
                    ShortcutState::Pressed => on_press(app),
                    ShortcutState::Released => on_release(app),
                }
            })?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::list_microphones,
            commands::list_models,
            commands::download_model,
            commands::get_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
