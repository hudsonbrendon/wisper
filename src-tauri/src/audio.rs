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
use cpal::{FromSample, Sample, SampleFormat, SizedSample, I24, U24};
use std::sync::{Arc, Mutex};

/// Build an input stream for one concrete sample type `T`, converting every
/// sample to `f32` in the callback and appending it to `buffer`.
fn build_input_stream_for<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    buffer: Arc<Mutex<Vec<f32>>>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    device
        .build_input_stream(
            *config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                if let Ok(mut b) = buffer.lock() {
                    b.extend(data.iter().map(|&s| f32::from_sample(s)));
                }
            },
            |e| eprintln!("audio stream error: {e}"),
            None,
        )
        .map_err(|e| format!("build input stream: {e}"))
}

/// Open a capture stream for the device, picking the build closure that matches
/// the device's *native* sample format. The previous code hard-coded `f32`,
/// which silently failed on the many inputs (common on Windows, and some macOS
/// devices) that report `i16` — the stream wouldn't build, so nothing was ever
/// captured and it looked exactly like a missing mic permission. Converting
/// from whatever the device delivers fixes capture across platforms.
fn open_input_stream(
    device: &cpal::Device,
    supported: &cpal::SupportedStreamConfig,
    buffer: Arc<Mutex<Vec<f32>>>,
) -> Result<cpal::Stream, String> {
    let config = supported.config();
    match supported.sample_format() {
        SampleFormat::I8 => build_input_stream_for::<i8>(device, &config, buffer),
        SampleFormat::I16 => build_input_stream_for::<i16>(device, &config, buffer),
        SampleFormat::I24 => build_input_stream_for::<I24>(device, &config, buffer),
        SampleFormat::I32 => build_input_stream_for::<i32>(device, &config, buffer),
        SampleFormat::I64 => build_input_stream_for::<i64>(device, &config, buffer),
        SampleFormat::U8 => build_input_stream_for::<u8>(device, &config, buffer),
        SampleFormat::U16 => build_input_stream_for::<u16>(device, &config, buffer),
        SampleFormat::U24 => build_input_stream_for::<U24>(device, &config, buffer),
        SampleFormat::U32 => build_input_stream_for::<u32>(device, &config, buffer),
        SampleFormat::U64 => build_input_stream_for::<u64>(device, &config, buffer),
        SampleFormat::F32 => build_input_stream_for::<f32>(device, &config, buffer),
        SampleFormat::F64 => build_input_stream_for::<f64>(device, &config, buffer),
        other => Err(format!("unsupported sample format: {other:?}")),
    }
}

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
    let throwaway = Arc::new(Mutex::new(Vec::new()));
    if let Ok(stream) = open_input_stream(&device, &cfg, throwaway) {
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

        // Open with the device's native sample format (converted to f32 in the
        // callback), not a hard-coded f32 stream that fails on i16 inputs.
        let stream = open_input_stream(&device, &cfg, buffer.clone())?;
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
