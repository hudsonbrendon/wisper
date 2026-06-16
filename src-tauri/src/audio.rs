/// Whisper expects 16 kHz mono f32 samples in [-1.0, 1.0].
pub const WHISPER_SAMPLE_RATE: u32 = 16_000;

/// Downmix interleaved multi-channel samples to mono by averaging channels.
/// `channels` must be >= 1. If channels == 1 the input is returned as-is.
pub fn to_mono(samples: &[f32], channels: u16) -> Vec<f32> {
    let ch = channels.max(1) as usize;
    if ch == 1 {
        return samples.to_vec();
    }
    samples
        .chunks(ch)
        .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
        .collect()
}

/// Resample mono samples from `src_rate` to 16 kHz using linear interpolation.
/// Good enough for speech recognition; not hi-fi.
pub fn resample_to_16k(samples: &[f32], src_rate: u32) -> Vec<f32> {
    if src_rate == WHISPER_SAMPLE_RATE || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = WHISPER_SAMPLE_RATE as f64 / src_rate as f64;
    let out_len = ((samples.len() as f64) * ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_pos = i as f64 / ratio;
        let idx = src_pos.floor() as usize;
        let frac = (src_pos - idx as f64) as f32;
        let a = samples[idx.min(samples.len() - 1)];
        let b = samples[(idx + 1).min(samples.len() - 1)];
        out.push(a + (b - a) * frac);
    }
    out
}

/// RMS amplitude of a buffer, for the live level meter. Returns 0.0 for empty.
pub fn rms_level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

/// RMS of only the trailing `window` samples. The live meter must track the
/// *current* voice amplitude, so it reads recent audio — not the RMS of the
/// whole take, which averages over everything captured so far and barely moves
/// once the buffer is large (making the meter look frozen).
pub fn rms_window(samples: &[f32], window: usize) -> f32 {
    if window == 0 || samples.is_empty() {
        return 0.0;
    }
    let start = samples.len().saturating_sub(window);
    rms_level(&samples[start..])
}

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};

/// Proactively open (and immediately close) the default input stream at startup
/// to trigger the macOS Microphone permission prompt early. Without this, the
/// prompt only appears on the first recording attempt — which then captures
/// silence while the user is still reading the dialog, so the meter never moves
/// and nothing transcribes. Best-effort: any error is ignored (e.g. no device).
pub fn prompt_microphone_access() {
    let host = cpal::default_host();
    let Some(device) = host.default_input_device() else {
        return;
    };
    let Ok(cfg) = device.default_input_config() else {
        return;
    };
    // Building + playing the stream is what makes CoreAudio hit the TCC gate and
    // surface the system dialog. We don't keep the audio — drop it right away.
    if let Ok(stream) = device.build_input_stream(
        cfg.config(),
        |_data: &[f32], _: &cpal::InputCallbackInfo| {},
        |e| eprintln!("mic warmup stream error: {e}"),
        None,
    ) {
        let _ = stream.play();
        std::thread::sleep(std::time::Duration::from_millis(200));
        drop(stream);
    }
}

/// List input device names available on the system.
pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    match host.input_devices() {
        Ok(devices) => devices.map(|d| d.to_string()).collect(),
        Err(_) => Vec::new(),
    }
}

/// An active microphone capture. Samples accumulate into a shared buffer at the
/// device's native rate/channels until `stop()` converts them to 16 kHz mono.
pub struct Recorder {
    stream: cpal::Stream,
    buffer: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
    channels: u16,
}

impl Recorder {
    /// Start capturing from `device_name` (None = system default input).
    pub fn start(device_name: Option<&str>) -> Result<Recorder, String> {
        let host = cpal::default_host();
        let default_device = || {
            host.default_input_device()
                .ok_or_else(|| "no default input device".to_string())
        };
        let device = match device_name {
            Some(name) => {
                let found = host
                    .input_devices()
                    .map_err(|e| format!("enumerate devices: {e}"))?
                    .find(|d| d.to_string() == name);
                match found {
                    Some(d) => d,
                    None => {
                        // The saved device is gone (e.g. AirPods disconnected) —
                        // fall back to the system default so dictation still works.
                        eprintln!("input device '{name}' not found; using system default");
                        default_device()?
                    }
                }
            }
            None => default_device()?,
        };
        let cfg = device
            .default_input_config()
            .map_err(|e| format!("default input config: {e}"))?;
        let sample_rate = cfg.sample_rate();
        let channels = cfg.channels();
        let buffer = Arc::new(Mutex::new(Vec::<f32>::new()));
        let buf_for_cb = buffer.clone();
        let err_fn = |e| eprintln!("audio stream error: {e}");

        let stream = device
            .build_input_stream(
                cfg.config(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if let Ok(mut b) = buf_for_cb.lock() {
                        b.extend_from_slice(data);
                    }
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("build input stream: {e}"))?;
        stream.play().map_err(|e| format!("play stream: {e}"))?;

        Ok(Recorder {
            stream,
            buffer,
            sample_rate,
            channels,
        })
    }

    /// Current RMS level of the most recent ~100 ms of audio, for the live
    /// meter. Windowed (not whole-buffer) so it tracks live voice amplitude
    /// instead of the slowly-moving average of the entire take.
    pub fn level(&self) -> f32 {
        // ~100 ms of interleaved native samples.
        let window = (self.sample_rate as usize) * (self.channels.max(1) as usize) / 10;
        self.buffer
            .lock()
            .map(|b| rms_window(&b, window))
            .unwrap_or(0.0)
    }

    /// Stop capture and return 16 kHz mono samples ready for Whisper.
    pub fn stop(self) -> Vec<f32> {
        drop(self.stream); // halts the callback
        let raw = self.buffer.lock().map(|b| b.clone()).unwrap_or_default();
        let mono = to_mono(&raw, self.channels);
        resample_to_16k(&mono, self.sample_rate)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mono_passthrough_when_single_channel() {
        let s = vec![0.1, 0.2, 0.3];
        assert_eq!(to_mono(&s, 1), s);
    }

    #[test]
    fn stereo_averages_pairs() {
        let s = vec![0.0, 1.0, 0.5, -0.5];
        assert_eq!(to_mono(&s, 2), vec![0.5, 0.0]);
    }

    #[test]
    fn resample_passthrough_when_already_16k() {
        let s = vec![0.1, 0.2, 0.3];
        assert_eq!(resample_to_16k(&s, 16_000), s);
    }

    #[test]
    fn resample_halves_length_from_32k() {
        let s: Vec<f32> = (0..100).map(|i| i as f32).collect();
        let out = resample_to_16k(&s, 32_000);
        assert_eq!(out.len(), 50);
    }

    #[test]
    fn rms_of_silence_is_zero() {
        assert_eq!(rms_level(&[0.0, 0.0, 0.0]), 0.0);
        assert_eq!(rms_level(&[]), 0.0);
    }

    #[test]
    fn rms_window_tracks_recent_audio_not_whole_buffer() {
        // Loud at the start, silent at the end: the live meter must read ~0,
        // even though the whole-buffer RMS is high. This is the bug that froze
        // the meter — it averaged the entire take.
        let mut loud_then_quiet = vec![1.0_f32; 100];
        loud_then_quiet.extend(std::iter::repeat_n(0.0, 100));
        assert_eq!(rms_window(&loud_then_quiet, 100), 0.0);

        // Silent then loud: meter must light up.
        let mut quiet_then_loud = vec![0.0_f32; 100];
        quiet_then_loud.extend(std::iter::repeat_n(1.0, 100));
        assert_eq!(rms_window(&quiet_then_loud, 100), 1.0);

        // Window larger than the buffer falls back to the full buffer.
        assert_eq!(rms_window(&[0.0, 0.0], 100), 0.0);
        assert_eq!(rms_window(&[], 100), 0.0);
        assert_eq!(rms_window(&[1.0], 0), 0.0);
    }
}
