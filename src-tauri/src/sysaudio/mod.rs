//! System (output) audio capture: the voices of the *other* meeting
//! participants coming out of the speakers. Two macOS backends behind one
//! trait — Core Audio process taps (CATap) on 14.4+ for the clean audio-only
//! permission prompt, ScreenCaptureKit on 13.0–14.3. Selected at runtime.

#[cfg(target_os = "macos")]
mod catap;
#[cfg(target_os = "macos")]
mod screencapturekit;

/// An active system-audio capture. Mirrors `audio::Recorder`: native samples
/// accumulate until `stop()` hands them back with their native rate/channels for
/// the caller to downmix + resample.
pub trait SystemAudioCapturer: Send {
    /// RMS of the most recent audio, for the bubble level meter.
    fn level(&self) -> f32;
    /// Stop and return (native f32 samples, sample_rate, channels).
    fn stop(self: Box<Self>) -> (Vec<f32>, u32, u16);
    /// A Send reader yielding new samples already converted to 16 kHz mono, for
    /// the live transcription loop. Captures `Arc`s of this capturer's buffer +
    /// cursor so it can move into the live thread while the capturer stays put
    /// (non-destructive — `stop` still returns the full take).
    fn reader(&self) -> SysReader;
}

/// Shareable reader over a system capturer's buffer for the live loop. The inner
/// closure pulls new native samples and returns them as 16 kHz mono. `Send` so it
/// can move into the live thread; each backend builds it over `Arc`s of its own
/// buffer/consumer + cursor.
pub struct SysReader(pub Box<dyn FnMut() -> Vec<f32> + Send>);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Catap,
    ScreenCaptureKit,
    Unsupported,
}

/// Pick the capture backend for a (major, minor) macOS version.
/// 14.4+ → CATap; 13.0–14.3 → ScreenCaptureKit; below 13 → Unsupported.
pub fn pick_backend(version: (u32, u32)) -> Backend {
    match version {
        (major, _) if major >= 15 => Backend::Catap,
        (14, minor) if minor >= 4 => Backend::Catap,
        (14, _) => Backend::ScreenCaptureKit,
        (13, _) => Backend::ScreenCaptureKit,
        _ => Backend::Unsupported,
    }
}

/// Current macOS version as (major, minor), or None off macOS / on error.
#[cfg(target_os = "macos")]
pub fn macos_version() -> Option<(u32, u32)> {
    let out = std::process::Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()?;
    let s = String::from_utf8(out.stdout).ok()?;
    let mut parts = s.trim().split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().unwrap_or(0);
    Some((major, minor))
}

#[cfg(not(target_os = "macos"))]
pub fn macos_version() -> Option<(u32, u32)> {
    None
}

/// Start capturing system audio with the right backend for this OS.
#[cfg(target_os = "macos")]
pub fn start_system_capture() -> Result<Box<dyn SystemAudioCapturer>, String> {
    let version = macos_version().ok_or("could not read macOS version")?;
    match pick_backend(version) {
        Backend::Catap => catap::start(),
        Backend::ScreenCaptureKit => screencapturekit::start(),
        Backend::Unsupported => Err("meeting capture needs macOS 13 or later".to_string()),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn start_system_capture() -> Result<Box<dyn SystemAudioCapturer>, String> {
    Err("meeting capture is macOS only".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_selection_by_version() {
        assert_eq!(pick_backend((12, 7)), Backend::Unsupported);
        assert_eq!(pick_backend((13, 0)), Backend::ScreenCaptureKit);
        assert_eq!(pick_backend((14, 0)), Backend::ScreenCaptureKit);
        assert_eq!(pick_backend((14, 3)), Backend::ScreenCaptureKit);
        assert_eq!(pick_backend((14, 4)), Backend::Catap);
        assert_eq!(pick_backend((15, 1)), Backend::Catap);
    }
}
