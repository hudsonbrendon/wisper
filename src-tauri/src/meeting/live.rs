//! Live (during-meeting) transcription loop. Reads the mic and system audio
//! incrementally, runs VAD to find closed speech segments, transcribes each with
//! the loaded Whisper model, and emits `meeting_live_segment` events. Ephemeral:
//! nothing here is persisted — the saved transcript still comes from the batch
//! re-pass in `MeetingRecorder::stop`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// Frame size for VAD at 16 kHz / 30 ms.
const VAD_FRAME: usize = 480;
const FRAME_MS: u64 = 30;
/// ~2 frames (~60 ms) of silence closes a segment.
const MIN_SILENCE_FRAMES: usize = 2;
/// How often the loop wakes to pull audio.
const TICK_MS: u64 = 1000;

/// Convert 16 kHz mono f32 in [-1, 1] to i16 PCM (what webrtc-vad expects),
/// clamping out-of-range values instead of wrapping.
pub fn to_i16(samples: &[f32]) -> Vec<i16> {
    samples
        .iter()
        .map(|&s| {
            // Scale to [-32768, 32767] using saturating cast so that:
            //   0.0 → 0, 1.0 → 32767 (i16::MAX), -1.0 → -32768 (i16::MIN).
            // Multiply by 32768.0 before saturating so -1.0 correctly yields
            // i16::MIN without relying on wrapping arithmetic.
            let scaled = s.clamp(-1.0, 1.0) * 32768.0_f32;
            scaled.min(i16::MAX as f32).max(i16::MIN as f32) as i16
        })
        .collect()
}

/// Closures that supply 16 kHz mono samples for each audio stream.
pub struct LiveSources {
    /// Reads new samples from the mic (16 kHz mono already converted) — Task 6 provides.
    pub read_me: Box<dyn FnMut() -> Vec<f32> + Send>,
    /// Reads new samples from system audio (16 kHz mono) — None if no system capture.
    pub read_them: Option<Box<dyn FnMut() -> Vec<f32> + Send>>,
}

pub struct LiveTranscriber {
    stop: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl LiveTranscriber {
    /// Spawn the live loop. `sources` supplies new 16 kHz mono samples per stream.
    /// `transcribe` turns a chunk of samples into segment texts (the caller wires it
    /// to the loaded model under its lock).
    pub fn start(
        app: AppHandle,
        mut sources: LiveSources,
        transcribe: Arc<dyn Fn(&[f32]) -> Vec<crate::stt::SttSegment> + Send + Sync>,
    ) -> LiveTranscriber {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_for_thread = stop.clone();
        let handle = std::thread::spawn(move || {
            // Per-source accumulators of 16 kHz mono samples not yet segmented,
            // plus the running sample offset (for absolute timestamps).
            let mut me_buf: Vec<f32> = Vec::new();
            let mut me_off: usize = 0;
            let mut them_buf: Vec<f32> = Vec::new();
            let mut them_off: usize = 0;

            let mut vad_me = webrtc_vad::Vad::new_with_rate_and_mode(
                webrtc_vad::SampleRate::Rate16kHz,
                webrtc_vad::VadMode::Quality,
            );
            let mut vad_them = webrtc_vad::Vad::new_with_rate_and_mode(
                webrtc_vad::SampleRate::Rate16kHz,
                webrtc_vad::VadMode::Quality,
            );

            while !stop_for_thread.load(Ordering::Relaxed) {
                std::thread::sleep(std::time::Duration::from_millis(TICK_MS));

                me_buf.extend((sources.read_me)());
                process_source(
                    &app,
                    "me",
                    &mut me_buf,
                    &mut me_off,
                    &mut vad_me,
                    &*transcribe,
                );

                if let Some(read_them) = sources.read_them.as_mut() {
                    them_buf.extend(read_them());
                    process_source(
                        &app,
                        "them",
                        &mut them_buf,
                        &mut them_off,
                        &mut vad_them,
                        &*transcribe,
                    );
                }
            }
        });
        LiveTranscriber {
            stop,
            handle: Some(handle),
        }
    }

    /// Signal the loop to stop and join it.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

/// Run VAD over the buffered samples, emit each closed segment's transcript, and
/// drop the consumed prefix from the buffer (advancing the absolute offset).
fn process_source(
    app: &AppHandle,
    speaker: &str,
    buf: &mut Vec<f32>,
    offset_samples: &mut usize,
    vad: &mut webrtc_vad::Vad,
    transcribe: &dyn Fn(&[f32]) -> Vec<crate::stt::SttSegment>,
) {
    // Compute VAD flags per whole 480-sample frame; leftover (< one frame) stays.
    let n_frames = buf.len() / VAD_FRAME;
    if n_frames == 0 {
        return;
    }
    let mut flags = Vec::with_capacity(n_frames);
    for f in 0..n_frames {
        let frame = &buf[f * VAD_FRAME..(f + 1) * VAD_FRAME];
        let pcm = to_i16(frame);
        let voiced = vad.is_voice_segment(&pcm).unwrap_or(false);
        flags.push(voiced);
    }

    let segs = segment_closed_speech(&flags, FRAME_MS, MIN_SILENCE_FRAMES);
    if segs.is_empty() {
        return;
    }

    // Highest consumed frame across closed segments — everything up to it is done.
    let mut max_end_frame = 0usize;
    for (start_ms, end_ms) in &segs {
        let start_frame = (*start_ms / FRAME_MS) as usize;
        let end_frame = (*end_ms / FRAME_MS) as usize; // exclusive
        max_end_frame = max_end_frame.max(end_frame);

        let s = start_frame * VAD_FRAME;
        let e = (end_frame * VAD_FRAME).min(buf.len());
        let chunk = &buf[s..e];
        for seg in transcribe(chunk) {
            // Absolute ms from meeting start: offset + segment-local position.
            let base_ms = crate::meeting::samples_to_ms(*offset_samples + s);
            let _ = app.emit(
                "meeting_live_segment",
                serde_json::json!({
                    "speaker": speaker,
                    "start_ms": base_ms + seg.start_ms,
                    "end_ms": base_ms + seg.end_ms,
                    "text": seg.text,
                }),
            );
        }
    }

    // Drop the consumed prefix; keep the open tail for the next tick.
    let consumed = (max_end_frame * VAD_FRAME).min(buf.len());
    *offset_samples += consumed;
    buf.drain(..consumed);
}

/// Turn a per-frame VAD flag stream into closed speech segments. A segment opens
/// on the first speech frame and closes once `min_silence_frames` consecutive
/// non-speech frames are seen — short gaps below that threshold are bridged so a
/// brief pause doesn't split a sentence. A segment still open at the end of the
/// slice (speech ongoing, or trailing silence shorter than the threshold) is NOT
/// returned, so the caller never paints text that might still grow. Times are ms
/// relative to the start of `flags` (`frame_ms` per frame).
pub fn segment_closed_speech(
    flags: &[bool],
    frame_ms: u64,
    min_silence_frames: usize,
) -> Vec<(u64, u64)> {
    let mut out = Vec::new();
    let mut seg_start: Option<usize> = None; // frame index where current speech began
    let mut last_speech: usize = 0; // frame index of the last speech frame seen
    let mut silence_run: usize = 0;

    for (i, &is_speech) in flags.iter().enumerate() {
        if is_speech {
            if seg_start.is_none() {
                seg_start = Some(i);
            }
            last_speech = i;
            silence_run = 0;
        } else if seg_start.is_some() {
            silence_run += 1;
            if silence_run >= min_silence_frames {
                let start = seg_start.take().unwrap();
                // end = one frame past the last speech frame (exclusive bound).
                out.push((start as u64 * frame_ms, (last_speech as u64 + 1) * frame_ms));
                silence_run = 0;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_i16_scales_and_clamps() {
        assert_eq!(to_i16(&[0.0]), vec![0]);
        assert_eq!(to_i16(&[1.0]), vec![i16::MAX]);
        assert_eq!(to_i16(&[-1.0]), vec![i16::MIN]);
        // Out-of-range clamps instead of wrapping.
        assert_eq!(to_i16(&[2.0]), vec![i16::MAX]);
        assert_eq!(to_i16(&[-2.0]), vec![i16::MIN]);
    }

    #[test]
    fn no_segments_for_all_silence() {
        let flags = vec![false; 10];
        assert!(segment_closed_speech(&flags, 30, 2).is_empty());
    }

    #[test]
    fn single_closed_segment() {
        // frames: F S S S S F F  (S=speech). 30ms frames, need 2 silence frames
        // to close. Speech is frames 1..=4 → 30ms..150ms.
        let flags = vec![false, true, true, true, true, false, false];
        assert_eq!(segment_closed_speech(&flags, 30, 2), vec![(30, 150)]);
    }

    #[test]
    fn trailing_open_segment_is_not_emitted() {
        // Speech runs to the end with no closing silence → not closed → excluded.
        let flags = vec![false, true, true, true];
        assert!(segment_closed_speech(&flags, 30, 2).is_empty());
    }

    #[test]
    fn short_gap_below_min_silence_does_not_split() {
        // One false between speech, min_silence_frames=2 → stays one segment.
        // S S F S S then 2 silence to close. Speech 0..=4 → 0..150ms.
        let flags = vec![true, true, false, true, true, false, false];
        assert_eq!(segment_closed_speech(&flags, 30, 2), vec![(0, 150)]);
    }

    #[test]
    fn two_segments_split_by_long_silence() {
        // S S (3x F) S → first closes at 60ms, second open at end (excluded).
        let flags = vec![true, true, false, false, false, true];
        assert_eq!(segment_closed_speech(&flags, 30, 2), vec![(0, 60)]);
    }
}
