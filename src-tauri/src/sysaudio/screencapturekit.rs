//! ScreenCaptureKit system-audio capture (macOS 13.0–14.3).
//!
//! Captures the whole output mix of the main display via ScreenCaptureKit and
//! accumulates the interleaved f32 PCM into a shared buffer, mirroring the
//! accumulate-then-`stop()` shape of `audio::Recorder`. The 14.4+ path uses
//! Core Audio process taps (`catap`) for the cleaner audio-only permission
//! prompt; this backend covers the older OSes where SCK is the only option.
//!
//! API note (screencapturekit 8.x): the builders consume `self` and return
//! `Self` (no `Result`), the audio sample comes out of
//! `CMSampleBuffer::audio_buffer_list()` as raw `&[u8]` we reinterpret as f32,
//! and `SCStream` is already `Send + Sync`.

use super::SystemAudioCapturer;
use crate::audio::rms_window;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use screencapturekit::{
    cm::{CMSampleBuffer, CMSampleBufferExt},
    shareable_content::SCShareableContent,
    stream::{
        configuration::SCStreamConfiguration, content_filter::SCContentFilter,
        output_trait::SCStreamOutputTrait, output_type::SCStreamOutputType, sc_stream::SCStream,
    },
};

/// We request 48 kHz stereo from ScreenCaptureKit; the caller downmixes +
/// resamples from these native parameters just like the mic path.
const SR: u32 = 48_000;
const CH: u16 = 2;

/// Output handler: appends interleaved f32 PCM from each audio sample buffer
/// onto the shared capture buffer. Called on ScreenCaptureKit's callback queue.
struct AudioSink {
    buffer: Arc<Mutex<Vec<f32>>>,
}

impl SCStreamOutputTrait for AudioSink {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if !matches!(of_type, SCStreamOutputType::Audio) {
            return;
        }
        // ScreenCaptureKit delivers audio as an AudioBufferList. With
        // interleaved capture there is a single buffer holding all channels;
        // each buffer's bytes are tightly packed f32 little-endian samples.
        let Some(list) = sample.audio_buffer_list() else {
            return;
        };
        let Ok(mut b) = self.buffer.lock() else {
            return;
        };
        for buf in list.iter() {
            let bytes = buf.data();
            // Reinterpret the raw bytes as f32. Drop any trailing partial
            // sample defensively (should never happen for PCM f32 frames).
            for chunk in bytes.chunks_exact(std::mem::size_of::<f32>()) {
                let arr = [chunk[0], chunk[1], chunk[2], chunk[3]];
                b.push(f32::from_le_bytes(arr));
            }
        }
    }
}

/// An active SCK capture. The `SCStream` keeps the capture session alive;
/// the buffer accumulates samples until `stop()` hands them back.
pub struct SckCapturer {
    stream: SCStream,
    buffer: Arc<Mutex<Vec<f32>>>,
    read_pos: AtomicUsize,
}

pub fn start() -> Result<Box<dyn SystemAudioCapturer>, String> {
    let content = SCShareableContent::get().map_err(|e| format!("shareable content: {e:?}"))?;
    let display = content
        .displays()
        .into_iter()
        .next()
        .ok_or("no display to capture")?;

    // Capture the entire display's output mix; we exclude no windows because we
    // only consume the audio, never the frames.
    let filter = SCContentFilter::create()
        .with_display(&display)
        .with_excluding_windows(&[])
        .build();

    // Audio-only intent: enable audio capture, ask for 48 kHz stereo, and
    // exclude our own process so we never record Wisper's own playback.
    let config = SCStreamConfiguration::new()
        .with_captures_audio(true)
        .with_sample_rate(SR as i32)
        .with_channel_count(CH as i32)
        .with_excludes_current_process_audio(true);

    let buffer = Arc::new(Mutex::new(Vec::<f32>::new()));
    let mut stream = SCStream::new(&filter, &config);
    stream.add_output_handler(
        AudioSink {
            buffer: buffer.clone(),
        },
        SCStreamOutputType::Audio,
    );
    stream
        .start_capture()
        .map_err(|e| format!("start sck: {e:?}"))?;

    Ok(Box::new(SckCapturer {
        stream,
        buffer,
        read_pos: AtomicUsize::new(0),
    }))
}

impl SystemAudioCapturer for SckCapturer {
    fn level(&self) -> f32 {
        // RMS over roughly the last 100 ms of interleaved samples, matching the
        // mic meter's responsiveness.
        let window = (SR as usize) * (CH as usize) / 10;
        self.buffer
            .lock()
            .map(|b| rms_window(&b, window))
            .unwrap_or(0.0)
    }

    fn stop(self: Box<Self>) -> (Vec<f32>, u32, u16) {
        let _ = self.stream.stop_capture();
        let raw = self.buffer.lock().map(|b| b.clone()).unwrap_or_default();
        (raw, SR, CH)
    }

    fn read_new(&self) -> Vec<f32> {
        let cursor = self.read_pos.load(Ordering::Relaxed);
        let buf = match self.buffer.lock() {
            Ok(b) => b,
            Err(_) => return Vec::new(),
        };
        let (new, advanced) = crate::audio::read_new_from(&buf, cursor);
        self.read_pos.store(advanced, Ordering::Relaxed);
        new
    }

    fn format(&self) -> (u32, u16) {
        (SR, CH)
    }
}
