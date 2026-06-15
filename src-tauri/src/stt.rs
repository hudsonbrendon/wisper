use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

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
    pub fn transcribe(&self, samples: &[f32], language: &str) -> Result<String, String> {
        let mut state = self
            .ctx
            .create_state()
            .map_err(|e| format!("create whisper state: {e}"))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        if language != "auto" {
            params.set_language(Some(language));
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
}
