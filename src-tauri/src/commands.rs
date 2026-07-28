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
    /// Active meeting recording, independent of the dictation state machine so
    /// hotkey dictation keeps working alongside it.
    pub meeting: Mutex<Option<crate::meeting::MeetingRecorder>>,
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    /// Model ids with a pending cancel request. The download loop checks this
    /// each chunk and aborts when its id is present.
    pub cancels: Mutex<std::collections::HashSet<String>>,
    /// Hotkey gesture detector (hold vs double-tap).
    pub hotkey: Mutex<crate::hotkey::Controller>,
    /// Whether someone is signed in, pushed by the frontend on every auth
    /// change. Starts `true` so the first dictation after launch is never
    /// blocked before the webview has reported in.
    pub signed_in: Mutex<bool>,
    /// Supabase user id of the signed-in account, or None when signed out. Set
    /// by the frontend via `set_active_user` on every auth change. Scopes the
    /// per-user data dir so one account never sees another's history/meetings.
    pub active_user: Mutex<Option<String>>,
}

impl AppState {
    /// Per-user data directory: `<data_dir>/users/<uid>/`. History and meetings
    /// live here, keyed on the signed-in account, so local data is isolated per
    /// user. Signed out → a single `_guest` bucket. Models stay in `data_dir`
    /// (unscoped) so they're shared across accounts, not re-downloaded per login.
    pub fn user_dir(&self) -> PathBuf {
        let uid = self.active_user.lock().unwrap();
        let bucket = uid.as_deref().map(sanitize_uid);
        self.data_dir
            .join("users")
            .join(bucket.as_deref().unwrap_or("_guest"))
    }
}

/// Keep only path-safe characters from a user id so it can be a directory name.
/// Supabase ids are UUIDs (`[0-9a-f-]`), already safe; this just guards against
/// a surprise value escaping the users/ folder.
fn sanitize_uid(uid: &str) -> String {
    uid.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect()
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
    let show_in_dock = new_config.show_in_dock;
    *state.config.lock().unwrap() = new_config;
    // Apply the system-toggle side effects immediately (idempotent + cheap).
    crate::apply_dock_visibility(&app, show_in_dock);
    crate::refresh_overlay_visibility(&app);
    Ok(())
}

/// Enable/disable launching Wisper at login (managed by the autostart plugin,
/// not stored in our config).
#[tauri::command]
pub fn set_launch_at_login(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let mgr = app.autolaunch();
    if enabled { mgr.enable() } else { mgr.disable() }.map_err(|e| e.to_string())
}

/// Whether Wisper is set to launch at login.
#[tauri::command]
pub fn get_launch_at_login(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Reset settings to defaults and wipe transcription history, then relaunch.
#[tauri::command]
pub fn reset_app(app: AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    config::save(&state.config_dir, &Config::default()).map_err(|e| format!("save config: {e}"))?;
    let _ = crate::history::clear(&state.user_dir());

    // On macOS, `app.restart()` exits via `std::process::exit`, whose C runtime
    // teardown runs ggml's Metal static destructor and aborts (the same crash
    // the `RunEvent::Exit` path avoids). Re-spawn ourselves and hard-exit with
    // `_exit` so those destructors never run.
    #[cfg(target_os = "macos")]
    {
        if let Ok(exe) = tauri::process::current_binary(&app.env()) {
            let _ = std::process::Command::new(exe).spawn();
        }
        unsafe { libc::_exit(0) }
    }
    #[cfg(not(target_os = "macos"))]
    app.restart();
}

/// Current macOS permission state shown in the Settings health panel.
#[derive(serde::Serialize)]
pub struct Permissions {
    pub accessibility: bool,
    pub microphone: bool,
}

#[tauri::command]
pub fn get_permissions() -> Permissions {
    #[cfg(target_os = "macos")]
    let accessibility = crate::inject::accessibility::is_trusted();
    #[cfg(not(target_os = "macos"))]
    let accessibility = true;
    let microphone = crate::audio::microphone_authorized();
    Permissions {
        accessibility,
        microphone,
    }
}

/// Re-run the Accessibility trust prompt (also re-registers the current binary
/// in TCC, recovering a stale grant left by an earlier build).
#[tauri::command]
pub fn prompt_accessibility() {
    crate::inject::prompt_accessibility_on_startup();
}

/// Reset the Microphone TCC grant and re-trigger the system prompt — the fix
/// when dictation captures silence after an update.
#[tauri::command]
pub fn reset_microphone() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("tccutil")
            .args(["reset", "Microphone", "chat.wisper"])
            .status();
        std::thread::spawn(crate::audio::prompt_microphone_access);
    }
}

/// Recover the Accessibility grant by re-registering the current binary in TCC
/// via the prompt. Unlike Microphone, this does NOT `tccutil reset`: a reset
/// removes the app from the Accessibility list and forces a manual re-add, while
/// `AXIsProcessTrustedWithOptions` re-registers and recovers a stale grant
/// (e.g. after a re-signed build) without revoking it.
#[tauri::command]
pub fn reset_accessibility() {
    crate::inject::prompt_accessibility_on_startup();
}

/// Open the OS privacy settings pane for "microphone" | "accessibility".
#[tauri::command]
pub fn open_privacy_settings(which: String) {
    #[cfg(target_os = "macos")]
    {
        let anchor = if which == "accessibility" {
            "Privacy_Accessibility"
        } else {
            "Privacy_Microphone"
        };
        let url = format!("x-apple.systempreferences:com.apple.preference.security?{anchor}");
        let _ = std::process::Command::new("open").arg(url).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        // Windows gates desktop-app mic access behind a privacy toggle; deep-link
        // straight to it so the user can flip it on.
        let uri = if which == "accessibility" {
            "ms-settings:privacy-accessibility"
        } else {
            "ms-settings:privacy-microphone"
        };
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", uri])
            .spawn();
    }
    #[cfg(target_os = "linux")]
    let _ = which;
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
    crate::history::read_all(&state.user_dir())
}

/// Bind local storage (history + meetings) to the signed-in account. Called by
/// the frontend on every auth change with the Supabase user id, or None on sign
/// out. Switching the active user re-points `user_dir()`, so the next reads see
/// only that account's data; the refresh events make the open views reload.
#[tauri::command]
pub fn set_active_user(app: AppHandle, state: tauri::State<AppState>, uid: Option<String>) {
    *state.active_user.lock().unwrap() = uid;
    let _ = std::fs::create_dir_all(state.user_dir());
    // Nudge the Home history list and the Meetings list to refetch under the
    // new scope (they listen for these events).
    let _ = app.emit("history_changed", serde_json::json!({}));
    let _ = app.emit("meeting_saved", serde_json::json!({ "id": "" }));
}

/// Wipe the local transcription history.
#[tauri::command]
pub fn clear_history(app: AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    crate::history::clear(&state.user_dir()).map_err(|e| format!("clear history: {e}"))?;
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

/// Start a meeting recording from the UI. Errors as a code string ("no_model",
/// "already_recording", or a capture error) the frontend maps to a message.
#[tauri::command]
pub fn start_meeting(app: AppHandle) -> Result<(), String> {
    crate::start_meeting(&app)
}

#[tauri::command]
pub fn stop_meeting(app: AppHandle) {
    crate::stop_meeting(&app);
}

#[tauri::command]
pub fn cancel_meeting(app: AppHandle) {
    crate::cancel_meeting(&app);
}

#[tauri::command]
pub fn meeting_level(state: tauri::State<AppState>) -> f32 {
    state
        .meeting
        .lock()
        .unwrap()
        .as_ref()
        .map(|r| r.level())
        .unwrap_or(0.0)
}

#[tauri::command]
pub fn get_meeting_state(state: tauri::State<AppState>) -> String {
    let recording = state.meeting.lock().unwrap().is_some();
    if recording { "recording" } else { "idle" }.to_string()
}

#[tauri::command]
pub fn list_meetings(state: tauri::State<AppState>) -> Vec<crate::meetings::MeetingSummary> {
    crate::meetings::list(&state.user_dir())
}

#[tauri::command]
pub fn get_meeting(state: tauri::State<AppState>, id: String) -> Option<crate::meetings::Meeting> {
    crate::meetings::get(&state.user_dir(), &id)
}

#[tauri::command]
pub fn delete_meeting(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    crate::meetings::delete(&state.user_dir(), &id).map_err(|e| format!("delete meeting: {e}"))
}

#[tauri::command]
pub fn rename_meeting(
    state: tauri::State<AppState>,
    id: String,
    title: String,
) -> Result<(), String> {
    crate::meetings::rename(&state.user_dir(), &id, &title)
        .map_err(|e| format!("rename meeting: {e}"))
}

/// Open a native "save file" dialog and write `contents` to the chosen path.
/// Returns the saved absolute path, or `None` if the user cancelled. The
/// transcript text is built on the frontend (it owns the localized speaker
/// labels); this command only handles the picker + write.
#[tauri::command]
pub async fn export_meeting_file(
    app: AppHandle,
    default_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("Text", &["txt"])
        .blocking_save_file();
    match path {
        Some(p) => {
            let pb = p
                .into_path()
                .map_err(|e| format!("resolve export path: {e}"))?;
            std::fs::write(&pb, contents).map_err(|e| format!("write export file: {e}"))?;
            Ok(Some(pb.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

/// Absolute path to a meeting's recorded audio, or None if there isn't one.
/// The frontend feeds this to `convertFileSrc` for the `<audio>` player.
#[tauri::command]
pub fn meeting_audio_path(state: tauri::State<AppState>, id: String) -> Option<String> {
    let p = crate::meetings::audio_path(&state.user_dir(), &id);
    p.exists().then(|| p.to_string_lossy().to_string())
}

/// Open a native save dialog and copy the meeting's WAV to the chosen path.
/// Returns the saved path, or None if cancelled.
#[tauri::command]
pub async fn export_meeting_audio(app: AppHandle, id: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (src, default_name) = {
        let state = app.state::<AppState>();
        let src = crate::meetings::audio_path(&state.user_dir(), &id);
        if !src.exists() {
            return Err("no_audio".into());
        }
        let name = crate::meetings::get(&state.user_dir(), &id)
            .map(|m| m.title.replace(['/', '\\', ':'], "-"))
            .unwrap_or_else(|| id.clone());
        (src, format!("{name}.wav"))
    };
    let path = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("Audio", &["wav"])
        .blocking_save_file();
    match path {
        Some(p) => {
            let dest = p
                .into_path()
                .map_err(|e| format!("resolve export path: {e}"))?;
            std::fs::copy(&src, &dest).map_err(|e| format!("copy audio: {e}"))?;
            Ok(Some(dest.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

/// Whether this OS can capture system audio at all (macOS 13+).
#[tauri::command]
pub fn meeting_supported() -> bool {
    match crate::sysaudio::macos_version() {
        Some(v) => crate::sysaudio::pick_backend(v) != crate::sysaudio::Backend::Unsupported,
        None => false,
    }
}

/// Has the user granted the screen/audio capture permission? Best-effort probe:
/// we attempt a capture start and immediately stop it; success = granted.
#[tauri::command]
pub fn check_system_audio_permission() -> bool {
    match crate::sysaudio::start_system_capture() {
        Ok(cap) => {
            let _ = cap.stop();
            true
        }
        Err(_) => false,
    }
}

/// Trigger the OS permission prompt by attempting a capture (which makes
/// CoreAudio/ScreenCaptureKit hit the TCC gate), then stop it.
#[tauri::command]
pub fn request_system_audio_permission() {
    if let Ok(cap) = crate::sysaudio::start_system_capture() {
        let _ = cap.stop();
    }
}

/// Open the macOS privacy pane for screen recording (covers both SCK and the
/// audio-capture entitlement surfaces).
#[tauri::command]
pub fn open_system_audio_settings() {
    #[cfg(target_os = "macos")]
    {
        let url = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
        let _ = std::process::Command::new("open").arg(url).spawn();
    }
}

/// Whether the local summary LLM is downloaded.
#[tauri::command]
pub fn llm_model_downloaded(state: tauri::State<AppState>) -> bool {
    model_manager::is_present(&state.data_dir, model_manager::llm_model_info())
}

/// Download the summary LLM, emitting "llm_download_progress" {received,total}.
#[tauri::command]
pub async fn download_llm_model(app: AppHandle) -> Result<(), String> {
    let info = model_manager::llm_model_info();
    let data_dir = app.state::<AppState>().data_dir.clone();
    let app_for_progress = app.clone();
    model_manager::download(&data_dir, info, move |received, total| {
        let _ = app_for_progress.emit(
            "llm_download_progress",
            serde_json::json!({ "received": received, "total": total }),
        );
        true // no cancel for the summary model in v1
    })
    .await?;
    let _ = app.emit("llm_model_ready", serde_json::json!({}));
    Ok(())
}

/// Path to the bundled `wisper-summarize` sidecar (next to the main binary in
/// the .app). In dev (`tauri dev`) it falls back to the workspace debug build.
fn summarize_sidecar_path() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let dir = exe.parent().ok_or("no exe dir")?;
    let bundled = dir.join("wisper-summarize");
    if bundled.exists() {
        return Ok(bundled);
    }
    // dev fallback: target/{debug,release}/wisper-summarize
    for profile in ["debug", "release"] {
        let p = dir.join("..").join(profile).join("wisper-summarize");
        if p.exists() {
            return Ok(p);
        }
    }
    Err("summarize sidecar not found".to_string())
}

/// Generate (or regenerate) the structured AI summary for a meeting by running
/// the isolated `wisper-summarize` sidecar, save it, and return the markdown.
/// Errors: "no_llm_model", "empty_transcript", "summary_unavailable".
#[tauri::command]
pub async fn generate_summary(app: AppHandle, id: String) -> Result<String, String> {
    // Models are shared across accounts (data_dir); the meeting itself is scoped
    // to the signed-in user (user_dir).
    let (data_dir, user_dir) = {
        let st = app.state::<AppState>();
        (st.data_dir.clone(), st.user_dir())
    };
    let mut meeting = crate::meetings::get(&user_dir, &id).ok_or("meeting not found")?;
    let transcript = crate::meetings::transcript_text(&meeting);
    if transcript.trim().is_empty() {
        return Err("empty_transcript".to_string());
    }
    if !model_manager::is_present(&data_dir, model_manager::llm_model_info()) {
        return Err("no_llm_model".to_string());
    }
    let language = meeting.language.clone();
    let model_path = model_manager::model_path(&data_dir, model_manager::llm_model_info());
    let sidecar = summarize_sidecar_path().map_err(|e| {
        eprintln!("generate_summary: {e}");
        "summary_unavailable".to_string()
    })?;

    // Run the sidecar off the async runtime (it's CPU/GPU heavy + blocking I/O).
    let markdown = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut child = Command::new(&sidecar)
            .arg("--model")
            .arg(&model_path)
            .arg("--language")
            .arg(&language)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn summarize: {e}"))?;
        child
            .stdin
            .take()
            .ok_or("no child stdin")?
            .write_all(transcript.as_bytes())
            .map_err(|e| format!("write transcript: {e}"))?;
        let out = child
            .wait_with_output()
            .map_err(|e| format!("wait summarize: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "summarize failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    })
    .await
    .map_err(|e| {
        eprintln!("generate_summary: {e}");
        "summary_unavailable".to_string()
    })
    .and_then(|inner| {
        inner.map_err(|e| {
            eprintln!("generate_summary: {e}");
            "summary_unavailable".to_string()
        })
    })?;

    if markdown.is_empty() {
        return Err("summary_unavailable".to_string());
    }
    meeting.summary = Some(markdown.clone());
    if let Err(e) = crate::meetings::save(&user_dir, &meeting) {
        eprintln!("save summary failed: {e}");
    }
    Ok(markdown)
}
