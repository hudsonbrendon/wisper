use crate::config::{self, Config};
use crate::model_manager::{self, ModelInfo};
use crate::state::State;
use crate::stt::Transcriber;
use std::path::PathBuf;
use std::sync::Mutex;
// Tauri 2.x: Emitter and Manager are traits at the crate root (tauri::Emitter,
// tauri::Manager). They are NOT re-exported inside a sub-module. AppHandle
// implements both without needing to import the traits for method resolution,
// but the traits must be in scope to call .emit() and .state() via trait dispatch.
use tauri::{AppHandle, Emitter, Manager};

/// App-wide shared state, behind a Mutex, owned by Tauri.
pub struct AppState {
    pub config: Mutex<Config>,
    pub machine: Mutex<State>,
    /// Loaded model; None until a model is present and loaded.
    pub transcriber: Mutex<Option<Transcriber>>,
    /// Active recorder while in Recording state.
    pub recorder: Mutex<Option<crate::audio::Recorder>>,
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    /// Model ids with a pending cancel request. The download loop checks this
    /// each chunk and aborts when its id is present.
    pub cancels: Mutex<std::collections::HashSet<String>>,
    /// Hotkey gesture detector (hold vs double-tap).
    pub hotkey: Mutex<crate::hotkey::Controller>,
}

/// Metadata sent to the frontend for each catalog model.
#[derive(serde::Serialize)]
pub struct ModelMeta {
    pub id: String,
    pub filename: String,
    pub downloaded: bool,
}

#[tauri::command]
pub fn get_config(state: tauri::State<AppState>) -> Config {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_config(
    app: AppHandle,
    state: tauri::State<AppState>,
    new_config: Config,
) -> Result<(), String> {
    let old_hotkey = state.config.lock().unwrap().hotkey.clone();
    let hotkey_changed = old_hotkey != new_config.hotkey;
    // Register the new shortcut FIRST. If the accelerator is invalid or
    // unsupported (e.g. modifiers with no key), bail out before persisting so a
    // broken hotkey is never saved and the old one keeps working.
    if hotkey_changed {
        crate::register_hotkey(&app, &new_config.hotkey).map_err(|e| {
            // Restore the previous, known-good binding.
            let _ = crate::register_hotkey(&app, &old_hotkey);
            format!("'{}' is not a valid shortcut: {e}", new_config.hotkey)
        })?;
    }
    config::save(&state.config_dir, &new_config).map_err(|e| format!("save config: {e}"))?;
    *state.config.lock().unwrap() = new_config;
    Ok(())
}

#[tauri::command]
pub fn list_microphones() -> Vec<String> {
    crate::audio::list_input_devices()
}

#[tauri::command]
pub fn list_models(state: tauri::State<AppState>) -> Vec<ModelMeta> {
    model_manager::catalog()
        .iter()
        .map(|m| ModelMeta {
            id: m.id.to_string(),
            filename: m.filename.to_string(),
            downloaded: model_manager::is_downloaded(&state.data_dir, m),
        })
        .collect()
}

/// Download a model by id, emitting "download_progress" events as it goes,
/// then load it as the active transcriber.
#[tauri::command]
pub async fn download_model(app: AppHandle, id: String) -> Result<(), String> {
    let info: &ModelInfo =
        model_manager::find(&id).ok_or_else(|| format!("unknown model: {id}"))?;
    let data_dir = app.state::<AppState>().data_dir.clone();
    // Clear any stale cancel flag from a previous run before starting.
    app.state::<AppState>().cancels.lock().unwrap().remove(&id);

    let app_for_progress = app.clone();
    let id_for_check = id.clone();
    let result = model_manager::download(&data_dir, info, move |received, total| {
        let _ = app_for_progress.emit(
            "download_progress",
            serde_json::json!({ "id": info.id, "received": received, "total": total }),
        );
        // Continue unless a cancel was requested for this id.
        !app_for_progress
            .state::<AppState>()
            .cancels
            .lock()
            .unwrap()
            .contains(&id_for_check)
    })
    .await;

    let path = match result {
        Ok(p) => p,
        Err(e) if e == model_manager::CANCELLED => {
            app.state::<AppState>().cancels.lock().unwrap().remove(&id);
            let _ = app.emit("download_cancelled", serde_json::json!({ "id": id }));
            return Ok(());
        }
        Err(e) => return Err(e),
    };

    // Load it as the active transcriber.
    let transcriber = Transcriber::load(path.to_str().ok_or("bad model path")?)?;
    *app.state::<AppState>().transcriber.lock().unwrap() = Some(transcriber);
    let _ = app.emit("model_ready", serde_json::json!({ "id": id }));
    Ok(())
}

/// Request cancellation of an in-flight download for `id`. The download loop
/// notices the flag on its next chunk and aborts, cleaning up the partial file.
#[tauri::command]
pub fn cancel_download(state: tauri::State<AppState>, id: String) {
    state.cancels.lock().unwrap().insert(id);
}

/// Delete a downloaded model from disk. If it is the currently-loaded model,
/// also drop the active transcriber so the file is no longer held open.
#[tauri::command]
pub fn remove_model(app: AppHandle, id: String) -> Result<(), String> {
    let info: &ModelInfo =
        model_manager::find(&id).ok_or_else(|| format!("unknown model: {id}"))?;
    let state = app.state::<AppState>();

    let is_active = state.config.lock().unwrap().model_id == id;
    if is_active {
        *state.transcriber.lock().unwrap() = None;
    }

    model_manager::remove(&state.data_dir, info)?;
    let _ = app.emit("model_removed", serde_json::json!({ "id": id }));
    Ok(())
}

#[tauri::command]
pub fn get_state(state: tauri::State<AppState>) -> String {
    crate::state::label(*state.machine.lock().unwrap()).to_string()
}

/// All recorded dictations, newest first. Powers the Home history list and the
/// Insights charts (which derive every stat from these entries on the frontend).
#[tauri::command]
pub fn get_history(state: tauri::State<AppState>) -> Vec<crate::history::Entry> {
    crate::history::read_all(&state.data_dir)
}

/// Wipe the local transcription history.
#[tauri::command]
pub fn clear_history(app: AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    crate::history::clear(&state.data_dir).map_err(|e| format!("clear history: {e}"))?;
    let _ = app.emit("history_changed", serde_json::json!({}));
    Ok(())
}

/// Start recording from the pill (same pipeline as the hotkey).
#[tauri::command]
pub fn ui_start_recording(app: AppHandle) {
    crate::start_recording(&app);
}

/// Stop recording from the pill, transcribe and insert.
#[tauri::command]
pub fn ui_stop_and_insert(app: AppHandle) {
    crate::stop_and_insert(&app);
}

/// Discard the in-progress take from the pill.
#[tauri::command]
pub fn ui_cancel_recording(app: AppHandle) {
    crate::cancel_recording(&app);
}

/// Set and persist the transcription language, then notify the pill.
#[tauri::command]
pub fn set_language(
    app: AppHandle,
    state: tauri::State<AppState>,
    lang: String,
) -> Result<(), String> {
    let saved = {
        let mut cfg = state.config.lock().unwrap();
        cfg.language = lang;
        config::save(&state.config_dir, &cfg).map_err(|e| format!("save config: {e}"))?;
        cfg.language.clone()
    };
    let _ = app.emit("config_changed", serde_json::json!({ "language": saved }));
    Ok(())
}

/// Expand the pill window (so the language dropdown can render) or collapse it.
#[tauri::command]
pub fn set_pill_expanded(app: AppHandle, expanded: bool) {
    crate::set_overlay_expanded(&app, expanded);
}
