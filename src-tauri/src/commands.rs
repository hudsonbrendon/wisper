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
pub fn save_config(state: tauri::State<AppState>, new_config: Config) -> Result<(), String> {
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

    let app_for_progress = app.clone();
    let path = model_manager::download(&data_dir, info, move |received, total| {
        let _ = app_for_progress.emit(
            "download_progress",
            serde_json::json!({ "id": info.id, "received": received, "total": total }),
        );
    })
    .await?;

    // Load it as the active transcriber.
    let transcriber = Transcriber::load(path.to_str().ok_or("bad model path")?)?;
    *app.state::<AppState>().transcriber.lock().unwrap() = Some(transcriber);
    let _ = app.emit("model_ready", serde_json::json!({ "id": id }));
    Ok(())
}

#[tauri::command]
pub fn get_state(state: tauri::State<AppState>) -> String {
    crate::state::label(*state.machine.lock().unwrap()).to_string()
}
