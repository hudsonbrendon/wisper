//! Orchestrates a meeting recording: the user's mic ("me") and the system
//! output ("them") captured in parallel, transcribed separately on stop and
//! merged into one time-ordered, speaker-labelled transcript.

mod live;

use crate::audio::{self, Recorder};
use crate::meetings::{self, Meeting};
use crate::stt::Transcriber;
use crate::sysaudio::{self, SystemAudioCapturer};

/// Whisper input is 16 kHz mono, so 16 samples = 1 ms.
pub fn samples_to_ms(len: usize) -> u64 {
    (len as u64) * 1000 / audio::WHISPER_SAMPLE_RATE as u64
}

pub struct MeetingRecorder {
    mic: Recorder,
    system: Option<Box<dyn SystemAudioCapturer>>,
    started_ms: u64,
}

impl MeetingRecorder {
    /// Start both captures. The mic is required; if system capture fails we
    /// still record the mic and mark the meeting partial on stop.
    pub fn start(mic_device: Option<&str>, started_ms: u64) -> Result<MeetingRecorder, String> {
        let mic = Recorder::start(mic_device)?;
        let system = match sysaudio::start_system_capture() {
            Ok(cap) => Some(cap),
            Err(e) => {
                eprintln!("system audio capture unavailable: {e}");
                None
            }
        };
        Ok(MeetingRecorder {
            mic,
            system,
            started_ms,
        })
    }

    /// Highest of the two live levels, for the bubble meter.
    pub fn level(&self) -> f32 {
        let mic = self.mic.level();
        let sys = self.system.as_ref().map(|s| s.level()).unwrap_or(0.0);
        mic.max(sys)
    }

    /// Stop both captures, transcribe each, merge, and build the Meeting.
    /// `partial` is true when system capture was unavailable or empty.
    pub fn stop(self, transcriber: &Transcriber, language: &str, prompt: &str) -> Meeting {
        let me_samples = self.mic.stop(); // already 16 kHz mono
        let (them_samples, had_system) = match self.system {
            Some(cap) => {
                let (raw, rate, channels) = cap.stop();
                let mono = audio::to_mono(&raw, channels);
                (audio::resample_to_16k(&mono, rate), !raw.is_empty())
            }
            None => (Vec::new(), false),
        };

        let me_segs = transcriber
            .transcribe_segments(&me_samples, language, prompt)
            .unwrap_or_default();
        let them_segs = if them_samples.len() >= 1600 {
            transcriber
                .transcribe_segments(&them_samples, language, prompt)
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        let segments = meetings::merge_segments(&me_segs, &them_segs);
        let duration_ms = samples_to_ms(me_samples.len().max(them_samples.len()));
        let id = self.started_ms.to_string();

        Meeting {
            id: id.clone(),
            title: meetings::default_title(self.started_ms),
            started_ms: self.started_ms,
            duration_ms,
            language: language.to_string(),
            partial: !had_system,
            segments,
        }
    }

    /// Drop both captures without transcribing.
    pub fn cancel(self) {
        drop(self.mic);
        if let Some(cap) = self.system {
            let _ = cap.stop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_to_ms_uses_16khz() {
        assert_eq!(samples_to_ms(16_000), 1000);
        assert_eq!(samples_to_ms(8_000), 500);
        assert_eq!(samples_to_ms(0), 0);
    }
}
