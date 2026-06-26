//! Desktop OAuth loopback: starts an ephemeral 127.0.0.1 server, and forwards
//! the redirect URL (with the `?code=...`) to the frontend via an event.

use tauri::{Emitter, Window};

/// Start a one-shot loopback server and return its port. The frontend builds
/// the Supabase OAuth URL with `redirectTo = http://127.0.0.1:<port>`, opens the
/// system browser, and waits for the `oauth://url` event carrying the callback
/// URL. The server shuts down automatically after the first request.
#[tauri::command]
pub async fn start_oauth_server(window: Window) -> Result<u16, String> {
    tauri_plugin_oauth::start(move |url| {
        // Best-effort: if the window is gone the login was abandoned.
        let _ = window.emit("oauth://url", url);
    })
    .map_err(|e| e.to_string())
}
