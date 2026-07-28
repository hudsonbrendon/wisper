//! Sign-in gate. The React webview owns Supabase auth and pushes the current
//! session state here; Rust blocks dictation and meetings while signed out.
//! Wisper has no paid plans, so this flag is the whole gate.

use crate::commands::AppState;

/// Frontend pushes the session state here on every auth change. It also pushes
/// `true` when Supabase isn't configured, so a build without credentials stays
/// fully usable.
#[tauri::command]
pub fn set_signed_in(state: tauri::State<AppState>, signed_in: bool) {
    *state.signed_in.lock().unwrap() = signed_in;
}
