//! Live (during-meeting) transcription loop. Reads the mic and system audio
//! incrementally, runs VAD to find closed speech segments, transcribes each with
//! the loaded Whisper model, and emits `meeting_live_segment` events. Ephemeral:
//! nothing here is persisted — the saved transcript still comes from the batch
//! re-pass in `MeetingRecorder::stop`.

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
