use crate::config::InjectMethod;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};

/// macOS Accessibility (AX) trust handling.
///
/// Synthesizing keystrokes requires the app to be a *trusted* accessibility
/// client. Without it, `enigo` still returns `Ok` but the OS silently drops
/// every event — so the text never lands and no error surfaces.
///
/// On ad-hoc–signed builds the TCC grant is keyed on the binary's code hash,
/// which changes on every rebuild: the Accessibility toggle stays *on* but
/// points at a dead identity, so `AXIsProcessTrusted()` keeps returning false.
/// Calling `AXIsProcessTrustedWithOptions` with the prompt flag re-registers
/// the *current* binary in the TCC list and shows the system dialog, which is
/// the reliable way to recover from a stale grant.
#[cfg(target_os = "macos")]
pub mod accessibility {
    use std::ffi::c_void;

    type CFTypeRef = *const c_void;
    type CFDictionaryRef = *const c_void;
    type CFStringRef = *const c_void;
    type CFBooleanRef = *const c_void;
    type CFAllocatorRef = *const c_void;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFBooleanTrue: CFBooleanRef;
        static kCFAllocatorDefault: CFAllocatorRef;
        static kCFTypeDictionaryKeyCallBacks: c_void;
        static kCFTypeDictionaryValueCallBacks: c_void;
        fn CFDictionaryCreate(
            allocator: CFAllocatorRef,
            keys: *const *const c_void,
            values: *const *const c_void,
            num_values: isize,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> CFDictionaryRef;
        fn CFRelease(cf: CFTypeRef);
    }

    /// True if the process is already a trusted accessibility client. No dialog,
    /// no side effects — safe to poll.
    pub fn is_trusted() -> bool {
        unsafe { AXIsProcessTrusted() }
    }

    /// Check trust and, if not yet trusted, pop the system Accessibility dialog.
    /// The call also (re)registers the running binary in the TCC list — this is
    /// what fixes a stale grant left behind by a previous build. When already
    /// trusted it returns `true` and shows nothing, so it is safe at startup.
    pub fn prompt() -> bool {
        unsafe {
            let keys = [kAXTrustedCheckOptionPrompt];
            let values = [kCFBooleanTrue];
            let opts = CFDictionaryCreate(
                kCFAllocatorDefault,
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks,
                &kCFTypeDictionaryValueCallBacks,
            );
            let trusted = AXIsProcessTrustedWithOptions(opts);
            CFRelease(opts);
            trusted
        }
    }
}

/// Prompt for Accessibility trust at startup (no-op when already granted or off
/// macOS). Surfacing the system dialog early re-registers the current binary in
/// TCC, recovering from a stale grant left by an earlier build.
pub fn prompt_accessibility_on_startup() {
    #[cfg(target_os = "macos")]
    let _ = accessibility::prompt();
}

#[cfg(target_os = "macos")]
fn ensure_accessibility_trusted() -> Result<(), String> {
    if accessibility::is_trusted() {
        Ok(())
    } else {
        // Not trusted: trigger the dialog (and re-register this binary) so the
        // user can fix it in one click instead of hunting through settings.
        accessibility::prompt();
        Err("Grant Accessibility permission to OpenWispr (System Settings → \
             Privacy & Security → Accessibility). If OpenWispr is already \
             listed and enabled, toggle it off and on — the previous build's \
             permission goes stale after an update."
            .to_string())
    }
}

#[cfg(not(target_os = "macos"))]
fn ensure_accessibility_trusted() -> Result<(), String> {
    Ok(())
}

/// Insert `text` into the currently focused application using the configured
/// method. On `Type` failure, automatically falls back to `Paste`.
pub fn insert(text: &str, method: InjectMethod) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }
    ensure_accessibility_trusted()?;
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
