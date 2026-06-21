//! Core Audio process-tap capture (macOS 14.4+). Implemented in Task 6.
use super::SystemAudioCapturer;

pub fn start() -> Result<Box<dyn SystemAudioCapturer>, String> {
    Err("CATap capture not yet implemented".to_string())
}
