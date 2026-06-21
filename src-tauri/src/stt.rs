use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(Debug, Clone, PartialEq)]
pub struct SttSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

/// Convert a Whisper (t0, t1) timestamp pair in centiseconds to (start_ms,
/// end_ms), clamping negatives to 0 and guaranteeing end_ms >= start_ms
/// (Whisper occasionally emits inverted times for leading-silence segments).
fn segment_times_ms(t0_cs: i64, t1_cs: i64) -> (u64, u64) {
    let start = t0_cs.max(0) as u64 * 10;
    let end = (t1_cs.max(0) as u64 * 10).max(start);
    (start, end)
}

/// Loads a Whisper ggml model and transcribes 16 kHz mono f32 audio.
pub struct Transcriber {
    ctx: WhisperContext,
}

impl Transcriber {
    /// Load a model from a ggml `.bin` file path.
    pub fn load(model_path: &str) -> Result<Transcriber, String> {
        let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
            .map_err(|e| format!("load whisper model: {e}"))?;
        Ok(Transcriber { ctx })
    }

    /// Transcribe 16 kHz mono samples. `language` is a code like "en"/"pt", or
    /// "auto" for autodetection.
    ///
    /// # API adaptations for whisper-rs 0.16.0
    /// - `full_n_segments()` returns `c_int` directly (not `Result`); no `.map_err()`.
    /// - `full_get_segment_text(i)` does not exist; replaced with `get_segment(i)`
    ///   which returns `Option<WhisperSegment<'_>>`, and `.to_str()` on the segment
    ///   (returns `Result<&str, WhisperError>`) to obtain the UTF-8 text.
    pub fn transcribe(
        &self,
        samples: &[f32],
        language: &str,
        prompt: &str,
    ) -> Result<String, String> {
        let mut state = self
            .ctx
            .create_state()
            .map_err(|e| format!("create whisper state: {e}"))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        if language != "auto" {
            params.set_language(Some(language));
        }
        // Vocabulary hints bias recognition toward the user's dictionary words.
        if !prompt.is_empty() {
            params.set_initial_prompt(prompt);
        }
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_print_timestamps(false);

        state
            .full(params, samples)
            .map_err(|e| format!("whisper full: {e}"))?;

        // Adaptation: full_n_segments() returns c_int (i32) directly in 0.16.0,
        // not a Result — no .map_err() needed.
        let num_segments = state.full_n_segments();

        let mut out = String::new();
        for i in 0..num_segments {
            // Adaptation: get_segment(i) returns Option<WhisperSegment<'_>>;
            // .to_str() on WhisperSegment returns Result<&str, WhisperError>.
            let seg = state
                .get_segment(i)
                .ok_or_else(|| format!("segment {i} out of bounds"))?;
            let text = seg.to_str().map_err(|e| format!("segment text: {e}"))?;
            out.push_str(text);
        }
        Ok(out.trim().to_string())
    }

    /// Like `transcribe`, but returns per-segment text with start/end times.
    /// Whisper reports segment times in centiseconds (1/100 s); convert to ms.
    /// Used by meeting transcription to interleave the mic and system streams.
    pub fn transcribe_segments(
        &self,
        samples: &[f32],
        language: &str,
        prompt: &str,
    ) -> Result<Vec<SttSegment>, String> {
        let mut state = self
            .ctx
            .create_state()
            .map_err(|e| format!("create whisper state: {e}"))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        if language != "auto" {
            params.set_language(Some(language));
        }
        if !prompt.is_empty() {
            params.set_initial_prompt(prompt);
        }
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_print_timestamps(false);

        state
            .full(params, samples)
            .map_err(|e| format!("whisper full: {e}"))?;

        let num_segments = state.full_n_segments();
        let mut out = Vec::with_capacity(num_segments as usize);
        for i in 0..num_segments {
            let seg = state
                .get_segment(i)
                .ok_or_else(|| format!("segment {i} out of bounds"))?;
            let text = seg.to_str().map_err(|e| format!("segment text: {e}"))?;
            // start_timestamp()/end_timestamp() are i64 centiseconds.
            let (t0, t1) = segment_times_ms(seg.start_timestamp(), seg.end_timestamp());
            out.push(SttSegment {
                start_ms: t0,
                end_ms: t1,
                text: text.trim().to_string(),
            });
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segment_times_clamp_negatives_and_inversions() {
        assert_eq!(segment_times_ms(0, 0), (0, 0));
        assert_eq!(segment_times_ms(5, 12), (50, 120));
        // inverted: end must not be < start
        assert_eq!(segment_times_ms(30, 10), (300, 300));
        // negative start clamps to 0
        assert_eq!(segment_times_ms(-1, 5), (0, 50));
    }
}
