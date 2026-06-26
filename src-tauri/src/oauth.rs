//! Desktop OAuth loopback: starts an ephemeral 127.0.0.1 server, and forwards
//! the redirect URL (with the `?code=...`) to the frontend via an event.

use tauri::{Emitter, Window};
use tauri_plugin_oauth::OauthConfig;

/// The page the system browser shows after the OAuth redirect hits our loopback.
/// Replaces the plugin's bare "Please return to the app." text with a styled,
/// self-closing confirmation so the handoff back to Wisper feels finished.
const SUCCESS_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Wisper — signed in</title>
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0c0a09; color: #fafaf9;
  }
  .card { text-align: center; padding: 40px 48px; }
  .check {
    width: 56px; height: 56px; margin: 0 auto 20px;
    border-radius: 9999px; background: #16a34a;
    display: flex; align-items: center; justify-content: center;
  }
  .check svg { width: 30px; height: 30px; stroke: #fff; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
  p { font-size: 14px; color: #a8a29e; margin: 0; }
</style>
</head>
<body>
  <div class="card">
    <div class="check">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
    </div>
    <h1>You're signed in</h1>
    <p>You can close this tab and return to Wisper.</p>
  </div>
  <script>setTimeout(() => { try { window.close(); } catch (e) {} }, 800);</script>
</body>
</html>"#;

/// Start a one-shot loopback server and return its port. The frontend builds
/// the Supabase OAuth URL with `redirectTo = http://127.0.0.1:<port>`, opens the
/// system browser, and waits for the `oauth://url` event carrying the callback
/// URL. The server shuts down automatically after the first request.
#[tauri::command]
pub async fn start_oauth_server(window: Window) -> Result<u16, String> {
    let config = OauthConfig {
        ports: None,
        response: Some(SUCCESS_PAGE.into()),
    };
    tauri_plugin_oauth::start_with_config(config, move |url| {
        // Best-effort: if the window is gone the login was abandoned.
        let _ = window.emit("oauth://url", url);
    })
    .map_err(|e| e.to_string())
}
