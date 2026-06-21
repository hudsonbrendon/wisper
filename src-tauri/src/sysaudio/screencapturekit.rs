//! ScreenCaptureKit capture (macOS 13.0–14.3). Implemented in Task 5.
use super::SystemAudioCapturer;

pub fn start() -> Result<Box<dyn SystemAudioCapturer>, String> {
    Err("ScreenCaptureKit capture not yet implemented".to_string())
}
