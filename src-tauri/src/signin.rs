//! Sign-in gate. The React webview owns Supabase auth and pushes the current
//! session state here; Rust blocks dictation and meetings while signed out.
//! Wisper has no paid plans, so this flag is the whole gate.

use crate::commands::AppState;
use tauri::{Emitter, Manager};

/// Frontend pushes the session state here on every auth change. It also pushes
/// `true` when Supabase isn't configured, so a build without credentials stays
/// fully usable.
#[tauri::command]
pub fn set_signed_in(state: tauri::State<AppState>, signed_in: bool) {
    *state.signed_in.lock().unwrap() = signed_in;
}

/// Ask the user to sign in for `metric` ("dictation" / "meeting"). The modal
/// lives inside the main window, which hides to the tray instead of quitting —
/// so surface that window too, or the prompt fires into an invisible one.
pub fn require_signin(app: &tauri::AppHandle, metric: &str) {
    let _ = app.emit("signin_required", serde_json::json!({ "metric": metric }));
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
