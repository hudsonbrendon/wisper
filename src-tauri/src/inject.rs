use crate::config::InjectMethod;
#[cfg(not(target_os = "macos"))]
use enigo::{Direction, Key};
use enigo::{Enigo, Keyboard, Settings};

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
        Err(
            "Grant Accessibility permission to Wisp (System Settings → \
             Privacy & Security → Accessibility). If Wisp is already \
             listed and enabled, toggle it off and on — the previous build's \
             permission goes stale after an update."
                .to_string(),
        )
    }
}

#[cfg(not(target_os = "macos"))]
fn ensure_accessibility_trusted() -> Result<(), String> {
    Ok(())
}

/// Parse a positive PID out of `lsappinfo info -only pid` output, e.g. the line
/// `"pid"=12345`. Returns `None` for missing/zero/unparseable values.
#[cfg(target_os = "macos")]
fn parse_lsappinfo_pid(output: &str) -> Option<i32> {
    output
        .rsplit('=')
        .next()?
        .trim()
        .trim_matches('"')
        .parse::<i32>()
        .ok()
        .filter(|&p| p > 0)
}

/// PID of the frontmost application (macOS), via `lsappinfo`. Used to target the
/// paste keystroke at the real destination app regardless of key-window focus.
#[cfg(target_os = "macos")]
fn frontmost_pid() -> Option<i32> {
    let out = std::process::Command::new("sh")
        .arg("-c")
        .arg("lsappinfo info -only pid $(lsappinfo front) 2>/dev/null")
        .output()
        .ok()?;
    parse_lsappinfo_pid(&String::from_utf8_lossy(&out.stdout))
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

/// macOS: post a real Cmd+V via CoreGraphics. Enigo's synthesized paste is
/// unreliable here (the keystroke is frequently ignored by the target app even
/// when AX-trusted), so we build the keyboard event directly with the Command
/// flag set and the hard-coded `v` keycode (9). Must run on the main thread
/// (the caller guarantees that). No layout/TSM lookup, so it never crashes.
#[cfg(target_os = "macos")]
mod cg {
    use std::ffi::c_void;
    type Ref = *const c_void;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceCreate(state_id: i32) -> Ref;
        fn CGEventCreateKeyboardEvent(source: Ref, keycode: u16, keydown: bool) -> Ref;
        fn CGEventSetFlags(event: Ref, flags: u64);
        fn CGEventPost(tap: u32, event: Ref);
        fn CGEventPostToPid(pid: i32, event: Ref);
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: Ref);
    }

    const KCG_HID_EVENT_TAP: u32 = 0;
    const KCG_FLAG_COMMAND: u64 = 0x0010_0000;
    const KCG_SOURCE_HID_SYSTEM_STATE: i32 = 1;
    const KEYCODE_V: u16 = 9;

    /// Synthesize Command+V. When `pid` is `Some`, deliver the events directly to
    /// that process (bypasses key-window/focus quirks — e.g. a floating overlay
    /// panel stealing the key window). Otherwise post to the system HID tap.
    pub fn cmd_v(pid: Option<i32>) {
        unsafe {
            let source = CGEventSourceCreate(KCG_SOURCE_HID_SYSTEM_STATE);
            let down = CGEventCreateKeyboardEvent(source, KEYCODE_V, true);
            let up = CGEventCreateKeyboardEvent(source, KEYCODE_V, false);
            if down.is_null() || up.is_null() {
                return;
            }
            CGEventSetFlags(down, KCG_FLAG_COMMAND);
            CGEventSetFlags(up, KCG_FLAG_COMMAND);
            match pid {
                Some(p) => {
                    CGEventPostToPid(p, down);
                    CGEventPostToPid(p, up);
                }
                None => {
                    CGEventPost(KCG_HID_EVENT_TAP, down);
                    CGEventPost(KCG_HID_EVENT_TAP, up);
                }
            }
            CFRelease(down);
            CFRelease(up);
            if !source.is_null() {
                CFRelease(source);
            }
        }
    }
}

/// Copy `text` to the clipboard and send the platform paste shortcut. On macOS
/// the keystroke is a native CGEvent Cmd+V delivered straight to the frontmost
/// app's PID — posting to the shared event tap let the floating overlay panel
/// (key window) swallow it, so nothing pasted. Elsewhere it's enigo Ctrl+V. The
/// user's previous clipboard is restored once the paste has been consumed.
fn paste_text(text: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("clipboard: {e}"))?;
    let saved = clipboard.get_text().ok();
    clipboard
        .set_text(text.to_string())
        .map_err(|e| format!("clipboard set: {e}"))?;
    // Let the clipboard write propagate before the paste reads it.
    std::thread::sleep(std::time::Duration::from_millis(80));
    #[cfg(target_os = "macos")]
    cg::cmd_v(frontmost_pid());
    #[cfg(not(target_os = "macos"))]
    {
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo init: {e}"))?;
        enigo
            .key(Key::Control, Direction::Press)
            .map_err(|e| format!("modifier press: {e}"))?;
        enigo
            .key(Key::Unicode('v'), Direction::Click)
            .map_err(|e| format!("v click: {e}"))?;
        enigo
            .key(Key::Control, Direction::Release)
            .map_err(|e| format!("modifier release: {e}"))?;
    }

    // Restore the user's previous clipboard once the paste has consumed it.
    if let Some(prev) = saved {
        std::thread::sleep(std::time::Duration::from_millis(250));
        let _ = clipboard.set_text(prev);
    }
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn parses_quoted_pid_line() {
        assert_eq!(parse_lsappinfo_pid("\"pid\"=12345"), Some(12345));
    }

    #[test]
    fn parses_pid_with_surrounding_whitespace() {
        assert_eq!(parse_lsappinfo_pid("  \"pid\" = 42 \n"), Some(42));
    }

    #[test]
    fn rejects_zero_and_garbage() {
        assert_eq!(parse_lsappinfo_pid("\"pid\"=0"), None);
        assert_eq!(parse_lsappinfo_pid("\"pid\"=-3"), None);
        assert_eq!(parse_lsappinfo_pid(""), None);
        assert_eq!(parse_lsappinfo_pid("no equals here"), None);
        assert_eq!(parse_lsappinfo_pid("\"pid\"=notanumber"), None);
    }
}
