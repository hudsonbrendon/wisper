//! Single-modifier hotkeys on macOS (e.g. push-to-talk on Option, like Wispr
//! Flow). The global-shortcut plugin can only bind modifier+key combos, never a
//! lone modifier. So when the configured hotkey is just a modifier, we watch the
//! raw `flagsChanged` stream with a listen-only CGEventTap and feed its rising/
//! falling edges into the same gesture controller as a normal press/release.
//!
//! The tap is created once (it needs Accessibility, which the app already
//! requires for injection) and the watched modifier is swapped atomically when
//! the hotkey changes — no need to tear the tap down. Listen-only means the
//! modifier keeps doing its normal job; we only observe it.

#![cfg(target_os = "macos")]

use std::os::raw::c_void;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;

// CGEventFlags modifier masks.
const FLAG_SHIFT: u64 = 0x0002_0000;
const FLAG_CONTROL: u64 = 0x0004_0000;
const FLAG_OPTION: u64 = 0x0008_0000;
const FLAG_COMMAND: u64 = 0x0010_0000;
const FLAG_FN: u64 = 0x0080_0000;

// CGEventType values we care about.
const FLAGS_CHANGED: u32 = 12;
const TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
const TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;

type CFRef = *const c_void;
type Callback = extern "C" fn(CFRef, u32, CFRef, *mut c_void) -> CFRef;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: Callback,
        user_info: *mut c_void,
    ) -> CFRef;
    fn CGEventTapEnable(tap: CFRef, enable: bool);
    fn CGEventGetFlags(event: CFRef) -> u64;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFMachPortCreateRunLoopSource(allocator: CFRef, port: CFRef, order: isize) -> CFRef;
    fn CFRunLoopGetCurrent() -> CFRef;
    fn CFRunLoopAddSource(rl: CFRef, source: CFRef, mode: CFRef);
    fn CFRunLoopRun();
    static kCFRunLoopCommonModes: CFRef;
}

/// If `accel` names a single modifier, return its CGEvent flag mask. Otherwise
/// (a combo, a normal key, or unknown) return `None` — those stay on the
/// global-shortcut path.
pub fn modifier_flag(accel: &str) -> Option<u64> {
    match accel.trim() {
        "Control" | "Ctrl" => Some(FLAG_CONTROL),
        "Alt" | "Option" | "Opt" => Some(FLAG_OPTION),
        "Shift" => Some(FLAG_SHIFT),
        "Super" | "Command" | "Cmd" | "Meta" => Some(FLAG_COMMAND),
        "Fn" | "Function" => Some(FLAG_FN),
        _ => None,
    }
}

struct Ctx {
    app: AppHandle,
    /// Watched modifier flag mask, or 0 when the hotkey isn't a lone modifier.
    watched: AtomicU64,
    /// Whether the watched modifier was down at the previous event (edge detect).
    last_down: AtomicBool,
    /// The tap's mach port, kept so we can re-enable it if the OS disables it.
    port: Mutex<CFRef>,
}
// The raw CFRef is only ever touched under the lock / on the tap thread.
unsafe impl Send for Ctx {}
unsafe impl Sync for Ctx {}

static CTX: OnceLock<Ctx> = OnceLock::new();

extern "C" fn on_event(_proxy: CFRef, etype: u32, event: CFRef, user_info: *mut c_void) -> CFRef {
    // SAFETY: `user_info` is the &'static Ctx we passed to CGEventTapCreate.
    let ctx = unsafe { &*(user_info as *const Ctx) };

    if etype == TAP_DISABLED_BY_TIMEOUT || etype == TAP_DISABLED_BY_USER_INPUT {
        let port = *ctx.port.lock().unwrap();
        if !port.is_null() {
            unsafe { CGEventTapEnable(port, true) };
        }
        return event;
    }

    if etype == FLAGS_CHANGED {
        let watched = ctx.watched.load(Ordering::Relaxed);
        if watched != 0 {
            let flags = unsafe { CGEventGetFlags(event) };
            let down = (flags & watched) != 0;
            let was = ctx.last_down.swap(down, Ordering::Relaxed);
            if down != was {
                crate::on_shortcut(&ctx.app, down);
            }
        }
    }
    event
}

/// Start the flagsChanged tap once, on its own run-loop thread. No-op if the tap
/// can't be created (e.g. Accessibility not yet granted) — the caller's startup
/// Accessibility prompt covers that, and a later hotkey change retries via the
/// already-running loop.
pub fn start(app: AppHandle) {
    let ctx = CTX.get_or_init(|| Ctx {
        app,
        watched: AtomicU64::new(0),
        last_down: AtomicBool::new(false),
        port: Mutex::new(std::ptr::null()),
    });
    let ctx_ptr = ctx as *const Ctx as usize;

    std::thread::spawn(move || unsafe {
        let mask: u64 = 1u64 << FLAGS_CHANGED;
        // The tap can only be created once Accessibility is granted. That grant
        // may arrive after startup (the user clicks Allow), and it's reset on
        // every update — so retry until it succeeds instead of forcing a
        // restart. Capped so a permanently-denied app doesn't spin forever.
        let mut port: CFRef = std::ptr::null();
        for _ in 0..150 {
            port = CGEventTapCreate(
                1, // kCGSessionEventTap
                0, // kCGHeadInsertEventTap
                1, // kCGEventTapOptionListenOnly
                mask,
                on_event,
                ctx_ptr as *mut c_void,
            );
            if !port.is_null() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
        if port.is_null() {
            eprintln!("modtap: CGEventTapCreate failed (Accessibility not granted)");
            return;
        }
        let ctx = &*(ctx_ptr as *const Ctx);
        *ctx.port.lock().unwrap() = port;
        let source = CFMachPortCreateRunLoopSource(std::ptr::null(), port, 0);
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
        CGEventTapEnable(port, true);
        CFRunLoopRun();
    });
}

/// Set (or clear) the watched lone modifier. Called from `register_hotkey`.
pub fn set_modifier(flag: Option<u64>) {
    if let Some(ctx) = CTX.get() {
        ctx.last_down.store(false, Ordering::Relaxed);
        ctx.watched.store(flag.unwrap_or(0), Ordering::Relaxed);
    }
}
