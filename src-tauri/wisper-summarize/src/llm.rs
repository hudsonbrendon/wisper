//! llama.cpp summary generation (isolated in this helper process).
//!
//! Loads the GGUF, generates, and drops the model — all in one call.
//! Ported verbatim from `src-tauri/src/summarizer.rs` (Summarizer::load +
//! Summarizer::summarize), restructured as a single free function.

use crate::prompt::build_prompt;
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use std::num::NonZeroU32;

/// Context window (in tokens) for a summary run. Must hold the (truncated)
/// transcript prompt plus the generated summary; a 24k-char transcript is ~8k
/// tokens, leaving room for MAX_NEW_TOKENS.
const N_CTX: u32 = 16384;

/// Hard cap on generated tokens so a runaway model can't loop forever.
const MAX_NEW_TOKENS: usize = 1024;

/// Load the GGUF, generate the structured summary, return markdown. The model
/// is loaded and dropped within this call (one-shot process).
pub fn summarize(model_path: &str, transcript: &str, language: &str) -> Result<String, String> {
    let prompt = build_prompt(transcript, language);

    // --- load ---
    let backend = LlamaBackend::init().map_err(|e| format!("llama backend: {e}"))?;
    // Offload all layers to the GPU on Metal builds; clamped to available on CPU.
    let model_params = LlamaModelParams::default().with_n_gpu_layers(1_000);
    let model = LlamaModel::load_from_file(&backend, model_path, &model_params)
        .map_err(|e| format!("load llm model: {e}"))?;

    // --- format with chat template (fallback to raw prompt) ---
    let formatted = format_with_chat_template(&model, &prompt).unwrap_or(prompt);

    // --- context ---
    // `n_batch` MUST cover the whole prompt: we feed it in a single decode and
    // llama.cpp asserts `n_tokens_all <= n_batch`. The default (512) crashes on
    // any transcript longer than a few sentences, so pin it to the context size.
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(Some(NonZeroU32::new(N_CTX).unwrap()))
        .with_n_batch(N_CTX);
    let mut ctx = model
        .new_context(&backend, ctx_params)
        .map_err(|e| format!("llm context: {e}"))?;

    // --- tokenize ---
    let tokens = model
        .str_to_token(&formatted, AddBos::Always)
        .map_err(|e| format!("tokenize: {e}"))?;
    if tokens.is_empty() {
        return Err("tokenize: empty prompt".to_string());
    }

    // Feed the whole prompt in one batch; only the final token needs logits.
    let mut batch = LlamaBatch::new(N_CTX as usize, 1);
    let last_idx = tokens.len() - 1;
    for (i, token) in tokens.iter().enumerate() {
        batch
            .add(*token, i as i32, &[0], i == last_idx)
            .map_err(|e| format!("batch: {e}"))?;
    }
    ctx.decode(&mut batch).map_err(|e| format!("decode: {e}"))?;

    // --- greedy decode loop ---
    let mut sampler = LlamaSampler::greedy();
    let mut decoder = encoding_rs::UTF_8.new_decoder();
    let mut out = String::new();

    for i in 0..MAX_NEW_TOKENS {
        let token = sampler.sample(&ctx, batch.n_tokens() - 1);
        sampler.accept(token);

        if model.is_eog_token(token) {
            break;
        }

        let piece = model
            .token_to_piece(token, &mut decoder, false, None)
            .map_err(|e| format!("detokenize: {e}"))?;
        out.push_str(&piece);

        // Feed the just-generated token back for the next step.
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
/// `None` if the GGUF has no template or the message/template can't be built.
fn format_with_chat_template(model: &LlamaModel, prompt: &str) -> Option<String> {
    let template = model.chat_template(None).ok()?;
    let message = LlamaChatMessage::new("user".to_string(), prompt.to_string()).ok()?;
    model.apply_chat_template(&template, &[message], true).ok()
}
