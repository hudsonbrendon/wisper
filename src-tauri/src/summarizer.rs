//! Local AI summary of a meeting transcript via llama.cpp (Metal on macOS).
//! `build_prompt`/`truncate_transcript` are pure; `Summarizer` loads a GGUF
//! instruct model and runs the summary. Everything stays on-device.

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use std::num::NonZeroU32;
use std::sync::Arc;

/// Context window (in tokens) for a summary run. `MAX_TRANSCRIPT_CHARS` plus the
/// prompt scaffolding plus the generated summary fit comfortably here.
const N_CTX: u32 = 8192;

/// Hard cap on generated tokens so a runaway model can't loop forever. The four
/// markdown sections of a meeting summary land well under this.
const MAX_NEW_TOKENS: usize = 1024;

/// Cap on transcript size fed to the model, leaving headroom under the 7B
/// context. Meetings above this are truncated (v1 — no chunk+merge).
pub const MAX_TRANSCRIPT_CHARS: usize = 24_000;

/// A loaded GGUF instruct model for summarization. Holds the backend + model;
/// a fresh context is created per `summarize` call so runs never share KV state.
pub struct Summarizer {
    /// The llama.cpp backend must outlive every context derived from it. Held in
    /// an `Arc` so `Summarizer` is cheap to move and clearly shares ownership.
    backend: Arc<LlamaBackend>,
    model: LlamaModel,
}

impl Summarizer {
    /// Load the GGUF model. On macOS the `metal` feature offloads to the GPU.
    pub fn load(model_path: &str) -> Result<Summarizer, String> {
        let backend = LlamaBackend::init().map_err(|e| format!("llama backend: {e}"))?;
        // Offload all layers to the GPU on Metal builds; on the CPU build this is
        // clamped to what's available, so the large value is harmless.
        let model_params = LlamaModelParams::default().with_n_gpu_layers(1_000);
        let model = LlamaModel::load_from_file(&backend, model_path, &model_params)
            .map_err(|e| format!("load llm model: {e}"))?;
        Ok(Summarizer {
            backend: Arc::new(backend),
            model,
        })
    }

    /// Summarize the transcript into structured markdown. Builds the Task-2
    /// prompt, wraps it in the model's chat template when one is baked into the
    /// GGUF, tokenizes, decodes the prompt, then greedily generates until the
    /// model emits an end-of-generation token or hits `MAX_NEW_TOKENS`.
    pub fn summarize(&self, transcript: &str, language: &str) -> Result<String, String> {
        let prompt = build_prompt(transcript, language);

        // Wrap in the model's baked-in chat template if it has one (so an instruct
        // model sees the role tags it was trained on); otherwise feed the raw
        // prompt. `add_ass = true` leaves the assistant turn open for generation.
        let formatted = self.format_with_chat_template(&prompt).unwrap_or(prompt);

        let ctx_params =
            LlamaContextParams::default().with_n_ctx(Some(NonZeroU32::new(N_CTX).unwrap()));
        let mut ctx = self
            .model
            .new_context(&self.backend, ctx_params)
            .map_err(|e| format!("llm context: {e}"))?;

        let tokens = self
            .model
            .str_to_token(&formatted, AddBos::Always)
            .map_err(|e| format!("tokenize: {e}"))?;
        if tokens.is_empty() {
            return Err("tokenize: empty prompt".to_string());
        }

        // Feed the whole prompt in one batch; only the final token needs logits
        // since that's where the first generated token is sampled from.
        let mut batch = LlamaBatch::new(N_CTX as usize, 1);
        let last_idx = tokens.len() - 1;
        for (i, token) in tokens.iter().enumerate() {
            batch
                .add(*token, i as i32, &[0], i == last_idx)
                .map_err(|e| format!("batch: {e}"))?;
        }
        ctx.decode(&mut batch).map_err(|e| format!("decode: {e}"))?;

        // Greedy decoding: deterministic output, which suits a structured summary.
        let mut sampler = LlamaSampler::greedy();
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        let mut out = String::new();

        for i in 0..MAX_NEW_TOKENS {
            // Sample from the logits produced by the most recent decode (the last
            // — and only — token carrying logits in the batch).
            let token = sampler.sample(&ctx, batch.n_tokens() - 1);
            sampler.accept(token);

            if self.model.is_eog_token(token) {
                break;
            }

            let piece = self
                .model
                .token_to_piece(token, &mut decoder, false, None)
                .map_err(|e| format!("detokenize: {e}"))?;
            out.push_str(&piece);

            // Feed the just-generated token back in as the next single-token batch.
            // Its absolute position is the prompt length plus how many tokens we've
            // already generated this loop.
            let pos = (tokens.len() + i) as i32;
            batch.clear();
            batch
                .add(token, pos, &[0], true)
                .map_err(|e| format!("batch: {e}"))?;
            ctx.decode(&mut batch).map_err(|e| format!("decode: {e}"))?;
        }

        Ok(out.trim().to_string())
    }

    /// Apply the model's baked-in chat template to a single user message. Returns
    /// `None` (caller falls back to the raw prompt) if the GGUF has no template or
    /// the message/template can't be built.
    fn format_with_chat_template(&self, prompt: &str) -> Option<String> {
        let template = self.model.chat_template(None).ok()?;
        let message = LlamaChatMessage::new("user".to_string(), prompt.to_string()).ok()?;
        self.model
            .apply_chat_template(&template, &[message], true)
            .ok()
    }
}

/// Truncate to `max_chars`, appending a short notice when cut. Cuts on a char
/// boundary (not a byte index) so multibyte text never panics.
pub fn truncate_transcript(transcript: &str, max_chars: usize) -> String {
    if transcript.chars().count() <= max_chars {
        return transcript.to_string();
    }
    let cut: String = transcript.chars().take(max_chars).collect();
    format!("{cut}\n… [transcrição truncada]")
}

/// Build the structured-summary prompt. Instructs the model to output the four
/// markdown sections in `language`, grounded only in the transcript.
pub fn build_prompt(transcript: &str, language: &str) -> String {
    let body = truncate_transcript(transcript, MAX_TRANSCRIPT_CHARS);
    format!(
        "Você é um assistente que resume reuniões. Resuma a transcrição abaixo \
         no idioma '{language}'. Use APENAS o que está na transcrição — não \
         invente fatos, nomes ou tarefas. Responda em markdown com EXATAMENTE \
         estas seções:\n\n\
         ## Resumo\n(2 a 3 frases)\n\n\
         ## Pontos-chave\n(itens com '-')\n\n\
         ## Decisões\n(itens com '-'; 'Nenhuma' se não houver)\n\n\
         ## Action items\n(itens '- [ ] tarefa — responsável'; 'Nenhum' se não houver)\n\n\
         Transcrição:\n\"\"\"\n{body}\n\"\"\"\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_keeps_short_transcript_intact() {
        let t = "linha 1\nlinha 2";
        assert_eq!(truncate_transcript(t, 100), t);
    }

    #[test]
    fn truncate_cuts_long_transcript_and_marks_it() {
        let t = "a".repeat(50);
        let out = truncate_transcript(&t, 10);
        assert!(out.starts_with("aaaaaaaaaa"));
        assert!(out.len() <= 10 + 64); // cut + a short notice
        assert!(out.contains("…"), "expected a truncation marker");
    }

    #[test]
    fn prompt_contains_transcript_and_sections_and_language() {
        let p = build_prompt("Você: oi", "pt");
        assert!(p.contains("Você: oi"));
        assert!(p.contains("Resumo"));
        assert!(p.contains("Pontos-chave"));
        assert!(p.contains("Decisões"));
        assert!(p.contains("Action items"));
        assert!(p.contains("pt"), "should instruct the output language");
    }

    #[test]
    fn prompt_truncates_long_transcript() {
        let long = "x".repeat(MAX_TRANSCRIPT_CHARS + 5_000);
        let p = build_prompt(&long, "pt");
        assert!(p.len() < long.len()); // truncated before embedding
        assert!(p.contains("…"));
    }
}
