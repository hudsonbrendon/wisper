use crate::config::InjectMethod;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};

/// Insert `text` into the currently focused application using the configured
/// method. On `Type` failure, automatically falls back to `Paste`.
pub fn insert(text: &str, method: InjectMethod) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }
    match method {
        InjectMethod::Type => match type_text(text) {
            Ok(()) => Ok(()),
            Err(e) => {
                eprintln!("type failed ({e}); falling back to paste");
                paste_text(text)
            }
        },
        InjectMethod::Paste => paste_text(text),
    }
}

/// Synthesize keystrokes for `text` via enigo.
///
/// Adaptation: enigo 0.6.1 returns `InputResult<T>` (an alias for
/// `Result<T, InputError>`) from `.text()` and `.key()`. `InputError` impls
/// `Display`, so we convert with `format!`.
/// `Enigo::new` returns `Result<Enigo, _>` in 0.6.1 (same as the spec target).
fn type_text(text: &str) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo init: {e}"))?;
    enigo.text(text).map_err(|e| format!("enigo text: {e}"))
}

/// Copy `text` to the clipboard and send the platform paste shortcut.
///
/// Adaptation: `Key::Meta` is the correct name in enigo 0.6.1 for the macOS
/// Command key (the older aliases `Key::Command` and `Key::Super` are marked
/// `#[deprecated(since = "0.0.12")]` but still compile; we use the canonical
/// `Key::Meta` as specified). On non-macOS targets `Key::Control` is used.
fn paste_text(text: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("clipboard: {e}"))?;
    clipboard
        .set_text(text.to_string())
        .map_err(|e| format!("clipboard set: {e}"))?;

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo init: {e}"))?;
    // Cmd on macOS, Ctrl elsewhere.
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;

    enigo
        .key(modifier, Direction::Press)
        .map_err(|e| format!("modifier press: {e}"))?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| format!("v click: {e}"))?;
    enigo
        .key(modifier, Direction::Release)
        .map_err(|e| format!("modifier release: {e}"))?;
    Ok(())
}
