# Local AI Meeting Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botão "Gerar resumo" no detalhe da reunião que roda um LLM local (Qwen2.5-7B-Instruct GGUF via llama.cpp/Metal) sobre o transcript salvo e produz um resumo estruturado em markdown, salvo na reunião.

**Architecture:** O resumo roda sobre o transcript já salvo: `transcript_text()` achata os segmentos Eu/Eles em texto, `build_prompt()` monta o prompt estruturado, e um `Summarizer` (llama-cpp-2, Metal) gera markdown off-thread, persistido em `Meeting.summary`. O modelo GGUF é baixado pela mesma infra do whisper (`model_manager`) e lazy-loaded no `AppState`. 100% local.

**Tech Stack:** Rust + Tauri 2, `llama-cpp-2` (binding llama.cpp, Metal no macOS), `model_manager` existente (download URL+sha256), React + TypeScript.

## Global Constraints

- **100% local:** o transcript nunca sai da máquina; sem nuvem, sem API key.
- **Modelo:** Qwen2.5-7B-Instruct Q4_K_M GGUF (~4.5 GB), arquivo ÚNICO, URL+sha256 fixos e verificados.
- **Sob demanda:** geração só no clique de "Gerar resumo" (nunca automático).
- **Estruturado:** o resumo tem as seções Resumo / Pontos-chave / Decisões / Action items, em markdown, no idioma do transcript.
- **Modelo residente:** `Summarizer` lazy-loaded no `AppState` no 1º uso, mantido em RAM.
- **Transcript longo é truncado** a um teto de caracteres (não chunk+merge).
- **Compat. retroativa:** `Meeting.summary` é `Option<String>` com `#[serde(default)]` — reuniões antigas (sem o campo) desserializam com `None`.
- **Cross-platform build:** `llama-cpp-2` com `metal` só no bloco macOS do `Cargo.toml`, sem feature no bloco não-macOS (espelha `whisper-rs`), pra não quebrar o CI Linux.
- **CI gates:** `cargo fmt` + `cargo clippy --all-targets -- -D warnings` + `pnpm format` (prettier no repo todo) + `pnpm lint` antes de cada commit. O job Rust roda no Linux.
- **Não alterar** o caminho de ditado nem a captura de reunião.

---

## File Structure

**Rust (novos):**

- `src-tauri/src/summarizer.rs` — `build_prompt`/`truncate_transcript` (puros) + `Summarizer` (llama-cpp-2).

**Rust (modificados):**

- `src-tauri/src/meetings.rs` — `Meeting.summary` + `transcript_text()`.
- `src-tauri/src/model_manager.rs` — `llm_model_info()`.
- `src-tauri/src/commands.rs` — `AppState.summarizer` + comandos.
- `src-tauri/src/lib.rs` — `mod summarizer;`, registro de comandos, init do AppState.
- `src-tauri/Cargo.toml` — `llama-cpp-2`.

**Frontend (modificados):**

- `src/lib/api.ts` — tipos + wrappers.
- `src/routes/MeetingDetail.tsx` — seção Resumo (gerar/baixar/renderizar markdown).
- `src/lib/i18n.tsx` — strings PT/EN.

---

## Task 1: Meeting.summary field + transcript_text (`meetings.rs`)

Persistência do resumo (retrocompatível) + achatamento dos segmentos. Puro/TDD.

**Files:**

- Modify: `src-tauri/src/meetings.rs`

**Interfaces:**

- Produces:
  - `Meeting.summary: Option<String>` (`#[serde(default)]`)
  - `fn transcript_text(m: &Meeting) -> String` — linhas `"Você: <texto>"` / `"Participantes: <texto>"` (uma por segmento, na ordem), juntas por `\n`.

- [ ] **Step 1: Write the failing tests**

Adicione ao `mod tests` em `src-tauri/src/meetings.rs`:

```rust
    #[test]
    fn old_meeting_without_summary_deserializes_to_none() {
        // A JSON from before the summary field existed must still load.
        let json = r#"{
            "id":"1","title":"m","started_ms":0,"duration_ms":0,
            "language":"pt","partial":false,
            "segments":[{"speaker":"me","start_ms":0,"end_ms":1,"text":"oi"}]
        }"#;
        let m: Meeting = serde_json::from_str(json).unwrap();
        assert_eq!(m.summary, None);
    }

    #[test]
    fn summary_roundtrips() {
        let dir = fresh_dir("summary_roundtrip");
        let mut m = meeting("5", 5, "hello");
        m.summary = Some("## Resumo\nok".to_string());
        save(&dir, &m).unwrap();
        assert_eq!(get(&dir, "5").unwrap().summary, Some("## Resumo\nok".to_string()));
    }

    #[test]
    fn transcript_text_labels_by_speaker_in_order() {
        let m = Meeting {
            id: "1".into(), title: "m".into(), started_ms: 0, duration_ms: 0,
            language: "pt".into(), partial: false, summary: None,
            segments: vec![
                Segment { speaker: "me".into(), start_ms: 0, end_ms: 1, text: "bom dia".into() },
                Segment { speaker: "them".into(), start_ms: 1, end_ms: 2, text: "oi".into() },
                Segment { speaker: "me".into(), start_ms: 2, end_ms: 3, text: "vamos".into() },
            ],
        };
        assert_eq!(
            transcript_text(&m),
            "Você: bom dia\nParticipantes: oi\nVocê: vamos"
        );
    }

    #[test]
    fn transcript_text_empty_when_no_segments() {
        let m = Meeting {
            id: "1".into(), title: "m".into(), started_ms: 0, duration_ms: 0,
            language: "pt".into(), partial: false, summary: None, segments: vec![],
        };
        assert_eq!(transcript_text(&m), "");
    }
```

> Note: the existing `meeting(...)` test helper builds a `Meeting` literal — adding the `summary` field below will require updating that helper (Step 3).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test meetings:: 2>&1 | tail -20`
Expected: FAIL — `Meeting` has no field `summary`; `transcript_text` not found.

- [ ] **Step 3: Implement the field + helper**

In `src-tauri/src/meetings.rs`, add the field to `Meeting` (after `segments`):

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Meeting {
    pub id: String,
    pub title: String,
    pub started_ms: u64,
    pub duration_ms: u64,
    pub language: String,
    pub partial: bool,
    pub segments: Vec<Segment>,
    /// Markdown AI summary, None until generated. `serde(default)` keeps
    /// meetings saved before this field existed loadable.
    #[serde(default)]
    pub summary: Option<String>,
}
```

Update the existing `meeting(...)` test helper to include `summary: None` in its literal (find it in `mod tests` and add the field).

Add the flattening helper (above `#[cfg(test)]`):

```rust
/// Flatten the segments into speaker-labelled lines for the summary prompt.
/// "me" → "Você", anything else → "Participantes". One line per segment, in
/// order, joined by newlines. Empty when there are no segments.
pub fn transcript_text(m: &Meeting) -> String {
    m.segments
        .iter()
        .map(|s| {
            let who = if s.speaker == "me" { "Você" } else { "Participantes" };
            format!("{who}: {}", s.text)
        })
        .collect::<Vec<_>>()
        .join("\n")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test meetings:: 2>&1 | tail -15`
Expected: PASS (all existing + 4 new).

- [ ] **Step 5: Format + commit**

```bash
cd src-tauri && cargo fmt
cd /Users/hudsonbrendon/Github/openwispr
git add src-tauri/src/meetings.rs
git commit -m "feat(meetings): summary field + transcript_text for AI summary"
```

---

## Task 2: Summary prompt + truncation (`summarizer.rs`, pure)

Cria `summarizer.rs` com SÓ as funções puras (sem a dep do llama ainda). Puro/TDD.

**Files:**

- Create: `src-tauri/src/summarizer.rs`
- Modify: `src-tauri/src/lib.rs` (declarar `mod summarizer;`)

**Interfaces:**

- Produces:
  - `fn truncate_transcript(transcript: &str, max_chars: usize) -> String`
  - `fn build_prompt(transcript: &str, language: &str) -> String`
  - `const MAX_TRANSCRIPT_CHARS: usize = 24_000;`

- [ ] **Step 1: Declare the module**

In `src-tauri/src/lib.rs`, add to the `mod` list (alphabetical, after `mod state;` / wherever fits): `mod summarizer;`.

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/summarizer.rs` with the test block + `use` only:

```rust
//! Local AI summary of a meeting transcript via llama.cpp (Metal on macOS).
//! `build_prompt`/`truncate_transcript` are pure; `Summarizer` loads a GGUF
//! instruct model and runs the summary. Everything stays on-device.

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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd src-tauri && cargo test summarizer:: 2>&1 | tail -15`
Expected: FAIL — functions/const not found.

- [ ] **Step 4: Implement the pure helpers**

Add above `#[cfg(test)]` in `summarizer.rs`:

```rust
/// Cap on transcript size fed to the model, leaving headroom under the 7B
/// context. Meetings above this are truncated (v1 — no chunk+merge).
pub const MAX_TRANSCRIPT_CHARS: usize = 24_000;

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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test summarizer:: 2>&1 | tail -10`
Expected: PASS (4 tests).

- [ ] **Step 6: Format + commit**

```bash
cd src-tauri && cargo fmt
cd /Users/hudsonbrendon/Github/openwispr
git add src-tauri/src/summarizer.rs src-tauri/src/lib.rs
git commit -m "feat(summarizer): structured summary prompt + transcript truncation"
```

---

## Task 3: Summarizer via llama-cpp-2 (native, manual verify)

**Nativo — verificação manual.** Adiciona a dep `llama-cpp-2` e implementa `Summarizer::load`/`summarize` com a API real do llama.cpp. Não unit-testável (precisa do modelo). Gate = compila limpo (macOS) + wiring real (sem `todo!()`).

**Files:**

- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/summarizer.rs`

**Interfaces:**

- Consumes: `build_prompt` (Task 2).
- Produces:
  - `struct Summarizer`
  - `fn Summarizer::load(model_path: &str) -> Result<Summarizer, String>`
  - `fn Summarizer::summarize(&self, transcript: &str, language: &str) -> Result<String, String>`

- [ ] **Step 1: Add the dep**

In `src-tauri/Cargo.toml`, mirror the `whisper-rs` split. In the macOS block (`[target."cfg(target_os = \"macos\")".dependencies]`):

```toml
llama-cpp-2 = { version = "0.1", features = ["metal"] }
```

In the non-macOS block (`[target."cfg(not(target_os = \"macos\"))".dependencies]`):

```toml
llama-cpp-2 = "0.1"
```

Run `cd src-tauri && cargo fetch 2>&1 | tail -5`; if `0.1` doesn't resolve, run `cargo add llama-cpp-2` and pin the resolved version. VERIFY the real API with `cargo doc -p llama-cpp-2` and the crate's `simple` example — the names below are the EXPECTED shape and may differ.

- [ ] **Step 2: Implement `Summarizer`**

Replace the module-level `use` (top of `summarizer.rs`) and add the struct/impl. The shape (adapt to the resolved crate API):

```rust
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use std::sync::Arc;

/// A loaded GGUF instruct model for summarization. Holds the backend + model;
/// a fresh context is created per `summarize` call.
pub struct Summarizer {
    backend: Arc<LlamaBackend>,
    model: LlamaModel,
}

impl Summarizer {
    /// Load the GGUF model. On macOS the `metal` feature offloads to the GPU.
    pub fn load(model_path: &str) -> Result<Summarizer, String> {
        let backend = LlamaBackend::init().map_err(|e| format!("llama backend: {e}"))?;
        // Offload all layers to GPU on Metal builds; harmless (0) on CPU builds.
        let model_params = LlamaModelParams::default().with_n_gpu_layers(1_000);
        let model = LlamaModel::load_from_file(&backend, model_path, &model_params)
            .map_err(|e| format!("load llm model: {e}"))?;
        Ok(Summarizer { backend: Arc::new(backend), model })
    }

    /// Summarize the transcript into structured markdown.
    pub fn summarize(&self, transcript: &str, language: &str) -> Result<String, String> {
        let prompt = build_prompt(transcript, language);

        // Wrap in the model's chat template if available, else use the raw prompt.
        let formatted = self
            .model
            .apply_chat_template(None, &[("user", prompt.as_str())], true)
            .unwrap_or(prompt);

        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(std::num::NonZeroU32::new(8192));
        let mut ctx = self
            .model
            .new_context(&self.backend, ctx_params)
            .map_err(|e| format!("llm context: {e}"))?;

        let tokens = self
            .model
            .str_to_token(&formatted, AddBos::Always)
            .map_err(|e| format!("tokenize: {e}"))?;

        let mut batch = LlamaBatch::new(8192, 1);
        let last = tokens.len() - 1;
        for (i, t) in tokens.iter().enumerate() {
            batch.add(*t, i as i32, &[0], i == last).map_err(|e| format!("batch: {e}"))?;
        }
        ctx.decode(&mut batch).map_err(|e| format!("decode: {e}"))?;

        // Greedy decode up to a generation cap; stop on EOG.
        let mut out = String::new();
        let mut n_cur = batch.n_tokens();
        let max_new = 1024;
        for _ in 0..max_new {
            let candidates = ctx.candidates_ith(batch.n_tokens() - 1);
            let token = ctx.sample_token_greedy(candidates); // adapt to real sampler API
            if self.model.is_eog_token(token) {
                break;
            }
            out.push_str(&self.model.token_to_str(token, Special::Tokenize).unwrap_or_default());
            batch.clear();
            batch.add(token, n_cur, &[0], true).map_err(|e| format!("batch: {e}"))?;
            n_cur += 1;
            ctx.decode(&mut batch).map_err(|e| format!("decode: {e}"))?;
        }
        Ok(out.trim().to_string())
    }
}
```

> This is the crate-integration crux. The exact sampler/token APIs (`candidates_ith`, `sample_token_greedy`, `token_to_str`, `Special`, `apply_chat_template`) MUST be checked against the resolved `llama-cpp-2` version's docs/`simple` example and adapted. Keep `build_prompt` from Task 2. No `todo!()`, no faked output. If a specific API can't be resolved after real effort, report DONE_WITH_CONCERNS naming it; if the crate is unusable, BLOCKED.

- [ ] **Step 3: Build (macOS)**

Run: `cd src-tauri && cargo build 2>&1 | tail -20`
Expected: compiles cleanly (this compiles llama.cpp — first build is slow). Fix API names until clean.

- [ ] **Step 4: Manual verification (deferred to Task 7)**

Functional summary needs the 4.5 GB model on a real Mac — deferred to Task 7. Record that it compiles and the wiring is real.

- [ ] **Step 5: Format + commit**

```bash
cd src-tauri && cargo fmt
cd /Users/hudsonbrendon/Github/openwispr
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/summarizer.rs
git commit -m "feat(summarizer): load + run a local GGUF model via llama-cpp-2"
```

---

## Task 4: LLM model in model_manager (`model_manager.rs`)

Adiciona o `ModelInfo` do LLM, reusando download/verify do whisper.

**Files:**

- Modify: `src-tauri/src/model_manager.rs`

**Interfaces:**

- Consumes: `ModelInfo`, `is_downloaded`, `model_path`, `download` (existentes).
- Produces: `fn llm_model_info() -> &'static ModelInfo`.

- [ ] **Step 1: Write the failing test**

Add to `mod tests` in `src-tauri/src/model_manager.rs` (or create one if absent — mirror existing test style):

```rust
    #[test]
    fn llm_model_info_is_a_single_gguf() {
        let m = llm_model_info();
        assert!(m.filename.ends_with(".gguf"));
        assert!(m.url.starts_with("https://"));
        assert_eq!(m.sha256.len(), 64); // pinned hex sha-256
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test model_manager::tests::llm_model_info 2>&1 | tail -10`
Expected: FAIL — `llm_model_info` not found.

- [ ] **Step 3: Implement**

Add to `src-tauri/src/model_manager.rs`:

```rust
/// The local summarization model (Qwen2.5-7B-Instruct, Q4_K_M GGUF, single
/// file). Downloaded/verified with the same infra as the Whisper models.
/// IMPORTANT: pin a SINGLE-FILE GGUF (the downloader fetches one URL) and the
/// real sha256 of that file before trusting this entry.
pub fn llm_model_info() -> &'static ModelInfo {
    &ModelInfo {
        id: "summary-qwen2.5-7b",
        filename: "qwen2.5-7b-instruct-q4_k_m.gguf",
        url: "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
        sha256: "<PIN_REAL_SHA256_OF_THE_DOWNLOADED_FILE>",
    }
}
```

> The implementer MUST replace `<PIN_REAL_SHA256...>` with the actual sha-256 of the file at that URL (download it once, `shasum -a 256`, paste). Confirm the URL is a single `.gguf` (not split into `-00001-of-0000N`). If bartowski's file is split, pick a single-file Q4_K_M GGUF from a trusted repo and pin its URL+sha256. A placeholder sha will fail the download's verification at runtime — this is the one value that cannot be left symbolic.

- [ ] **Step 4: Run the test + build**

Run: `cd src-tauri && cargo test model_manager:: 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Format + commit**

```bash
cd src-tauri && cargo fmt
cd /Users/hudsonbrendon/Github/openwispr
git add src-tauri/src/model_manager.rs
git commit -m "feat(model_manager): catalog entry for the local summary LLM"
```

---

## Task 5: Commands + AppState wiring (`commands.rs`, `lib.rs`)

Expõe os comandos e o estado do summarizer. Compila + suíte verde (sem novos unit tests — é glue Tauri).

**Files:**

- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**

- Consumes: `summarizer::Summarizer`, `meetings::{get, save, transcript_text, Meeting}`, `model_manager::{llm_model_info, is_downloaded, model_path, download}`.
- Produces (comandos): `generate_summary`, `llm_model_downloaded`, `download_llm_model`.

- [ ] **Step 1: Add the AppState field**

In `src-tauri/src/commands.rs`, in `pub struct AppState`, add (after `transcriber`):

```rust
    /// Lazy-loaded local summarization model; None until first summary.
    pub summarizer: Mutex<Option<crate::summarizer::Summarizer>>,
```

In `src-tauri/src/lib.rs`, in the `app.manage(AppState { ... })` block, add:

```rust
                summarizer: Mutex::new(None),
```

- [ ] **Step 2: Add the commands**

Add to the end of `src-tauri/src/commands.rs`:

```rust
/// Whether the local summary LLM is downloaded.
#[tauri::command]
pub fn llm_model_downloaded(state: tauri::State<AppState>) -> bool {
    model_manager::is_downloaded(&state.data_dir, model_manager::llm_model_info())
}

/// Download the summary LLM, emitting "llm_download_progress" {received,total}.
#[tauri::command]
pub async fn download_llm_model(app: AppHandle) -> Result<(), String> {
    let info = model_manager::llm_model_info();
    let data_dir = app.state::<AppState>().data_dir.clone();
    let app_for_progress = app.clone();
    model_manager::download(&data_dir, info, move |received, total| {
        let _ = app_for_progress.emit(
            "llm_download_progress",
            serde_json::json!({ "received": received, "total": total }),
        );
        true // no cancel for the summary model in v1
    })
    .await?;
    let _ = app.emit("llm_model_ready", serde_json::json!({}));
    Ok(())
}

/// Generate (or regenerate) the structured AI summary for a meeting, save it,
/// and return the markdown. Lazy-loads the model on first use. Errors:
/// "no_llm_model" if not downloaded, "empty_transcript" if no speech.
#[tauri::command]
pub async fn generate_summary(app: AppHandle, id: String) -> Result<String, String> {
    let data_dir = app.state::<AppState>().data_dir.clone();
    let mut meeting = crate::meetings::get(&data_dir, &id).ok_or("meeting not found")?;
    let transcript = crate::meetings::transcript_text(&meeting);
    if transcript.trim().is_empty() {
        return Err("empty_transcript".to_string());
    }
    if !model_manager::is_downloaded(&data_dir, model_manager::llm_model_info()) {
        return Err("no_llm_model".to_string());
    }
    let language = meeting.language.clone();

    // Heavy: load (if needed) + run off the async runtime's worker via spawn_blocking.
    let markdown = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let app_state = app.state::<AppState>();
        let mut guard = app_state.summarizer.lock().unwrap();
        if guard.is_none() {
            let path = model_manager::model_path(&data_dir, model_manager::llm_model_info());
            *guard = Some(crate::summarizer::Summarizer::load(
                path.to_str().ok_or("bad model path")?,
            )?);
        }
        let summarizer = guard.as_ref().unwrap();
        summarizer.summarize(&transcript, &language)
    })
    .await
    .map_err(|e| format!("summary task: {e}"))??;

    // Persist; best-effort (still return the markdown if save fails).
    meeting.summary = Some(markdown.clone());
    let data_dir2 = app.state::<AppState>().data_dir.clone();
    if let Err(e) = crate::meetings::save(&data_dir2, &meeting) {
        eprintln!("save summary failed: {e}");
    }
    Ok(markdown)
}
```

> `app` is moved into `spawn_blocking`; re-clone `data_dir`/`app` as shown so the post-save still has a handle. Adapt if the borrow checker wants an earlier clone. The summarizer lock is held across the blocking summary (serialized, intentional — like the transcriber).

- [ ] **Step 3: Register the commands**

In `src-tauri/src/lib.rs`, in `tauri::generate_handler![ ... ]`, add:

```rust
            commands::llm_model_downloaded,
            commands::download_llm_model,
            commands::generate_summary,
```

- [ ] **Step 4: Build + suite + clippy**

Run: `cd src-tauri && cargo build 2>&1 | tail -10` (compiles)
Run: `cd src-tauri && cargo test 2>&1 | tail -5` (green)
Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings 2>&1 | tail -8` (no new warnings)

- [ ] **Step 5: Format + commit**

```bash
cd src-tauri && cargo fmt
cd /Users/hudsonbrendon/Github/openwispr
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(summary): tauri commands + summarizer state wiring"
```

---

## Task 6: Frontend summary section (`api.ts`, `MeetingDetail.tsx`, i18n)

Seção Resumo no detalhe: gerar / baixar modelo / renderizar markdown. Build + tests.

**Files:**

- Modify: `src/lib/api.ts`
- Modify: `src/routes/MeetingDetail.tsx`
- Modify: `src/lib/i18n.tsx`

**Interfaces:**

- Consumes: comandos `generate_summary`, `llm_model_downloaded`, `download_llm_model`; evento `llm_download_progress`.
- Produces: `Meeting.summary?: string`; wrappers `generateSummary`, `llmModelDownloaded`, `downloadLlmModel`; `LlmDownloadProgressPayload`.

- [ ] **Step 1: Add types + wrappers (api.ts)**

In `src/lib/api.ts`, add `summary?: string;` to the `Meeting` interface (after `segments`), and add:

```typescript
export const generateSummary = (id: string) =>
  invoke<string>("generate_summary", { id });
export const llmModelDownloaded = () => invoke<boolean>("llm_model_downloaded");
export const downloadLlmModel = () => invoke<void>("download_llm_model");

export type LlmDownloadProgressPayload = { received: number; total: number };
```

- [ ] **Step 2: Add the summary section to MeetingDetail**

In `src/routes/MeetingDetail.tsx`:

(a) extend imports:

```tsx
import {
  getMeeting,
  renameMeeting,
  deleteMeeting,
  generateSummary,
  llmModelDownloaded,
  downloadLlmModel,
  onEvent,
  type Meeting,
  type LlmDownloadProgressPayload,
} from "../lib/api";
```

(b) add a minimal markdown renderer near the top of the file (module scope), since the summary is controlled markdown (headings, bullets, checkboxes, paragraphs):

```tsx
/// Tiny renderer for the LLM summary markdown: ## headings, "-"/"- [ ]" bullets,
/// and paragraphs. Not a general markdown parser — just what build_prompt emits.
function renderSummary(md: string) {
  return md.split("\n").map((raw, i) => {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      return (
        <h3 key={i} className="mt-4 mb-1 text-sm font-semibold">
          {line.slice(3)}
        </h3>
      );
    }
    if (line.startsWith("- [ ] ") || line.startsWith("- [x] ")) {
      return (
        <label key={i} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            readOnly
            checked={line.startsWith("- [x]")}
            className="mt-1"
          />
          <span>{line.slice(6)}</span>
        </label>
      );
    }
    if (line.startsWith("- ")) {
      return (
        <li key={i} className="ml-5 list-disc text-sm">
          {line.slice(2)}
        </li>
      );
    }
    if (line.trim() === "") return <div key={i} className="h-2" />;
    return (
      <p key={i} className="text-sm">
        {line}
      </p>
    );
  });
}
```

(c) add state + handlers inside the component (after the existing `meeting`/`title` state):

```tsx
const [hasModel, setHasModel] = useState<boolean | null>(null);
const [summaryBusy, setSummaryBusy] = useState(false);
const [dlPct, setDlPct] = useState<number | null>(null);
const [summaryError, setSummaryError] = useState<string | null>(null);

useEffect(() => {
  llmModelDownloaded().then(setHasModel);
  const un = onEvent<LlmDownloadProgressPayload>("llm_download_progress", (p) =>
    setDlPct(p.total ? Math.round((p.received / p.total) * 100) : 0),
  );
  return () => {
    un.then((f) => f());
  };
}, []);

const downloadModel = async () => {
  setSummaryError(null);
  setDlPct(0);
  try {
    await downloadLlmModel();
    setHasModel(true);
  } catch (e) {
    setSummaryError(String(e));
  } finally {
    setDlPct(null);
  }
};

const genSummary = async () => {
  setSummaryError(null);
  setSummaryBusy(true);
  try {
    const md = await generateSummary(id);
    setMeeting((m) => (m ? { ...m, summary: md } : m));
  } catch (e) {
    const msg = String(e);
    setSummaryError(
      msg.includes("no_llm_model")
        ? t("meetings.summaryNoModel")
        : msg.includes("empty_transcript")
          ? t("meetings.summaryEmpty")
          : msg,
    );
  } finally {
    setSummaryBusy(false);
  }
};
```

(d) render the Resumo section (place it above the segment transcript list in the returned JSX):

```tsx
<section className="mb-6">
  <div className="mb-2 flex items-center justify-between">
    <h2 className="text-lg font-semibold">{t("meetings.summaryTitle")}</h2>
    {hasModel === false ? (
      dlPct === null ? (
        <button
          type="button"
          onClick={downloadModel}
          className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-800 dark:hover:bg-stone-800"
        >
          {t("meetings.summaryDownloadModel")}
        </button>
      ) : (
        <span className="text-sm text-stone-500">{`${t("meetings.summaryDownloading")} ${dlPct}%`}</span>
      )
    ) : (
      <button
        type="button"
        disabled={summaryBusy}
        onClick={genSummary}
        className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm hover:bg-stone-100 disabled:opacity-40 dark:border-stone-800 dark:hover:bg-stone-800"
      >
        {summaryBusy
          ? t("meetings.summaryGenerating")
          : meeting.summary
            ? t("meetings.summaryRegenerate")
            : t("meetings.summaryGenerate")}
      </button>
    )}
  </div>
  {summaryError && (
    <p className="mb-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
      {summaryError}
    </p>
  )}
  {meeting.summary ? (
    <div className="rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
      {renderSummary(meeting.summary)}
    </div>
  ) : (
    !summaryBusy && (
      <p className="text-sm text-stone-500">{t("meetings.summaryHint")}</p>
    )
  )}
</section>
```

- [ ] **Step 3: Add i18n strings (PT + EN)**

In `src/lib/i18n.tsx`, add to BOTH dicts (grep first to avoid dupes):

```
meetings.summaryTitle         "Summary"                 / "Resumo"
meetings.summaryGenerate      "Generate summary"        / "Gerar resumo"
meetings.summaryRegenerate    "Regenerate"              / "Regerar"
meetings.summaryGenerating    "Generating…"             / "Gerando…"
meetings.summaryHint          "No summary yet."         / "Sem resumo ainda."
meetings.summaryDownloadModel "Download summary model (~4.5GB)" / "Baixar modelo de resumo (~4.5GB)"
meetings.summaryDownloading   "Downloading model"       / "Baixando modelo"
meetings.summaryNoModel       "Download the summary model first." / "Baixe o modelo de resumo primeiro."
meetings.summaryEmpty         "This meeting has no speech to summarize." / "Esta reunião não tem fala para resumir."
```

- [ ] **Step 4: Build + tests**

Run: `pnpm build 2>&1 | tail -8` (tsc + vite ok)
Run: `pnpm test 2>&1 | tail -5` (green)
Run: `pnpm lint 2>&1 | tail -3` (eslint clean)

- [ ] **Step 5: Format + commit**

```bash
cd /Users/hudsonbrendon/Github/openwispr
pnpm format
git add src/lib/api.ts src/routes/MeetingDetail.tsx src/lib/i18n.tsx
git commit -m "feat(meetings): AI summary section in the meeting detail"
```

---

## Task 7: End-to-end manual verification + docs

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Full automated verification**

Run: `cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings 2>&1 | tail -8 && cargo test 2>&1 | tail -5`
Expected: fmt clean, clippy clean, tests green.
Run: `cd /Users/hudsonbrendon/Github/openwispr && pnpm lint && pnpm test 2>&1 | tail -5 && pnpm build 2>&1 | tail -3`
Expected: all green. Verify tracked-file prettier: `git ls-files | grep -E '\.(md|ts|tsx|json)$' | xargs npx prettier --check`.

- [ ] **Step 2: Build + reinstall (project workflow)**

Build signed with `APPLE_SIGNING_IDENTITY="OpenWispr Dev"` (or directly, since the config now points at the real cert), reinstall to `/Applications`, per the project's rebuild/reinstall workflow.

- [ ] **Step 3: Manual end-to-end checklist (real Mac)**

- Open a saved meeting → Resumo section shows **Baixar modelo de resumo (~4.5GB)** the first time → download with progress → completes.
- Click **Gerar resumo** → "Gerando…" → after a few seconds the structured summary (Resumo / Pontos-chave / Decisões / Action items) renders.
- Reopen the meeting → the summary persists (saved in JSON).
- **Regerar** produces a fresh summary.
- A meeting with no speech → shows the empty-transcript notice, doesn't generate.
- Dictation + meeting capture still work (no regression with the LLM resident in RAM).

- [ ] **Step 4: Document**

Add a short note to `README.md` (near the meeting feature) that meetings can generate a local AI summary (structured notes/action items) on demand, fully offline, requiring a one-time model download. Match surrounding tone/language.

- [ ] **Step 5: Format + commit**

```bash
cd /Users/hudsonbrendon/Github/openwispr
pnpm format
git add README.md
git commit -m "docs: document local AI meeting summary"
```

---

## Self-Review

**1. Spec coverage:**

- `Meeting.summary` + retrocompat → Task 1. ✓
- `transcript_text` → Task 1. ✓
- `build_prompt` + truncamento → Task 2. ✓
- `Summarizer` (llama-cpp-2, Metal) → Task 3. ✓
- modelo no model_manager (download/verify) → Task 4. ✓
- comandos `generate_summary`/`llm_model_downloaded`/`download_llm_model` + AppState `summarizer` + lazy-load + off-thread → Task 5. ✓
- bordas (no_llm_model, empty_transcript, save best-effort) → Task 5. ✓
- UI Resumo (gerar/regerar/baixar/progresso/render markdown) + i18n → Task 6. ✓
- docs + manual verify → Task 7. ✓
- cross-platform Cargo split (metal macOS) → Task 3. ✓

**2. Placeholder scan:** Os corpos puros (Tasks 1,2,4) têm código completo. Task 3 (llama-cpp-2) é ancorada no `simple` example da crate com gate manual — sem `todo!()`. O ÚNICO valor deliberadamente simbólico é o `sha256` do GGUF na Task 4, marcado explicitamente como "fixar o sha real" (não pode ser inventado; falharia a verificação em runtime). ✓

**3. Type consistency:**

- `transcript_text(&Meeting) -> String` — Task 1, usado em Task 5. ✓
- `build_prompt(&str,&str)->String` / `MAX_TRANSCRIPT_CHARS` / `truncate_transcript` — Task 2, usados em Task 3. ✓
- `Summarizer::load/summarize` — Task 3, usados em Task 5. ✓
- `llm_model_info()->&ModelInfo` — Task 4, usado em Task 5. ✓
- comandos snake_case ↔ wrappers `api.ts` camelCase (generate_summary/generateSummary etc.) — Tasks 5/6. ✓
- evento `llm_download_progress {received,total}` — emitido Task 5, tipado Task 6. ✓
- `Meeting.summary` (Rust Option<String> ↔ TS `summary?: string`) — Tasks 1/6. ✓
