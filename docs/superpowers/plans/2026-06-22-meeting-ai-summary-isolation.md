# AI Summary — Process Isolation Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the local LLM summary in a SEPARATE process (a bundled sidecar binary that links only llama-cpp-2), so it no longer corrupts the in-process whisper-rs (the two ggml static libs clash). Restores all whisper transcription and keeps the local-first AI summary.

**Architecture:** A new workspace member crate `wisper-summarize` depends ONLY on `llama-cpp-2` and builds a CLI binary: it reads the transcript from stdin + `--model`/`--language` args, builds the prompt, runs llama.cpp (Metal), and writes the markdown summary to stdout. The main `src-tauri` app drops `llama-cpp-2` entirely (un-corrupting whisper), bundles the helper as a Tauri `externalBin` sidecar, and `generate_summary` spawns it as a subprocess.

**Tech Stack:** Rust workspace, `llama-cpp-2` (helper only, Metal on macOS), Tauri 2 `externalBin` sidecar, `whisper-rs` (main app, now isolated), React/TS (unchanged).

## Global Constraints

- **`src-tauri` (main app) must NOT depend on `llama-cpp-2` or `encoding_rs`** after this rework — that link is what corrupts whisper. Only the `wisper-summarize` helper links llama.
- **100% local:** transcript passed to the helper via stdin (a child process on the same machine); nothing leaves the device.
- **Model:** the helper loads the GGUF whose path the main app passes (the model is still downloaded by the main app's `model_manager`, Qwen2.5-7B-Instruct Q4_K_M, sha256 `65b8fcd92af6b4fefa935c625d1ac27ea29dcb6ee14589c55a8f115ceaaa1423`).
- **Sidecar name:** binary `wisper-summarize`; Tauri externalBin entry `binaries/wisper-summarize`; the build places `src-tauri/binaries/wisper-summarize-<TARGET_TRIPLE>` before bundling.
- **Workspace root = `src-tauri/Cargo.toml`** (it gains `[workspace] members = ["wisper-summarize"]`); helper lives at `src-tauri/wisper-summarize/`; shared target dir `src-tauri/target/`.
- **Summary structure unchanged:** Resumo / Pontos-chave / Decisões / Action items (the prompt moves to the helper).
- **CI:** the Rust job runs clippy/tests on the `wisper` package only (`--manifest-path src-tauri/Cargo.toml`, not `--workspace`), so it will NOT compile the helper's llama.cpp — keep it that way (CI stays fast and llama-free). `cargo fmt`/`clippy -D warnings`/`pnpm format`/`pnpm lint` gates before each commit.
- **Keep unchanged from the prior branch work:** `Meeting.summary` + `transcript_text` (meetings.rs), `model_manager::llm_model_info` + download, and the entire frontend summary UI (it calls the same `generate_summary` command).

---

## File Structure

**New:**

- `src-tauri/wisper-summarize/Cargo.toml` — helper crate (bin), deps: `llama-cpp-2` (metal macOS), `encoding_rs`.
- `src-tauri/wisper-summarize/src/main.rs` — CLI: args + stdin → prompt → llama → stdout.
- `src-tauri/wisper-summarize/src/prompt.rs` — `build_prompt`/`truncate_transcript` (moved from src-tauri/summarizer.rs) + tests.
- `scripts/before-build.sh` — builds the helper, copies it to `binaries/<name>-<triple>`, then runs `pnpm build`.

**Modified:**

- `src-tauri/Cargo.toml` — add `[workspace]`; REMOVE `llama-cpp-2` + `encoding_rs`.
- `src-tauri/src/summarizer.rs` — DELETE (its `build_prompt` moves to the helper; the `Summarizer` is gone; the spawn logic lives in `commands.rs`).
- `src-tauri/src/lib.rs` — remove `mod summarizer;`.
- `src-tauri/src/commands.rs` — `generate_summary` rewritten to spawn the sidecar.
- `src-tauri/tauri.conf.json` — `bundle.externalBin`; `beforeBuildCommand` → the script.

**Unchanged (already on branch):** `meetings.rs` (summary + transcript_text), `model_manager.rs` (llm_model_info), `src/lib/api.ts`, `src/routes/MeetingDetail.tsx`, `src/lib/i18n.tsx`.

---

## Task 1: Workspace + helper crate with the pure prompt (moved)

Create the workspace + `wisper-summarize` crate, move `build_prompt`/`truncate_transcript` + tests into it (pure, TDD). The CLI `main` for now reads args+stdin and prints the prompt (a real, testable CLI; llama comes in Task 2).

**Files:**

- Modify: `src-tauri/Cargo.toml` (add `[workspace]`)
- Create: `src-tauri/wisper-summarize/Cargo.toml`, `src-tauri/wisper-summarize/src/main.rs`, `src-tauri/wisper-summarize/src/prompt.rs`

**Interfaces:**

- Produces (in the helper crate): `prompt::build_prompt(transcript: &str, language: &str) -> String`, `prompt::truncate_transcript(&str, usize) -> String`, `prompt::MAX_TRANSCRIPT_CHARS`.

- [ ] **Step 1: Make src-tauri a workspace root**

In `src-tauri/Cargo.toml`, add at the very top (before `[package]`):

```toml
[workspace]
members = ["wisper-summarize"]
```

(A package can also be a workspace root; this keeps the helper in the same target dir.)

- [ ] **Step 2: Create the helper crate manifest**

Create `src-tauri/wisper-summarize/Cargo.toml`:

```toml
[package]
name = "wisper-summarize"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "wisper-summarize"
path = "src/main.rs"

[dependencies]
encoding_rs = "0.8"

[target."cfg(target_os = \"macos\")".dependencies]
llama-cpp-2 = { version = "0.1.150", features = ["metal"] }

[target."cfg(not(target_os = \"macos\"))".dependencies]
llama-cpp-2 = "0.1.150"
```

- [ ] **Step 3: Write the failing prompt tests in the helper**

Create `src-tauri/wisper-summarize/src/prompt.rs` with the tests + `use` only (these are the SAME tests that currently live in `src-tauri/src/summarizer.rs` — move them):

```rust
//! Pure prompt construction for the summary helper. No llama here.

pub const MAX_TRANSCRIPT_CHARS: usize = 24_000;

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
        assert!(out.contains("…"));
    }

    #[test]
    fn prompt_contains_transcript_and_sections_and_language() {
        let p = build_prompt("Você: oi", "pt");
        assert!(p.contains("Você: oi"));
        assert!(p.contains("Resumo"));
        assert!(p.contains("Pontos-chave"));
        assert!(p.contains("Decisões"));
        assert!(p.contains("Action items"));
        assert!(p.contains("pt"));
    }

    #[test]
    fn prompt_truncates_long_transcript() {
        let long = "x".repeat(MAX_TRANSCRIPT_CHARS + 5_000);
        let p = build_prompt(&long, "pt");
        assert!(p.len() < long.len());
        assert!(p.contains("…"));
    }
}
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd src-tauri && cargo test -p wisper-summarize 2>&1 | tail -15`
Expected: FAIL — `build_prompt`/`truncate_transcript` not found.

- [ ] **Step 5: Implement the pure functions (copy from the old summarizer.rs)**

Add to `src-tauri/wisper-summarize/src/prompt.rs` above `#[cfg(test)]` (identical bodies to the current `src-tauri/src/summarizer.rs`):

```rust
/// Truncate to `max_chars` on a char boundary, appending a notice when cut.
pub fn truncate_transcript(transcript: &str, max_chars: usize) -> String {
    if transcript.chars().count() <= max_chars {
        return transcript.to_string();
    }
    let cut: String = transcript.chars().take(max_chars).collect();
    format!("{cut}\n… [transcrição truncada]")
}

/// Build the structured-summary prompt in `language`, grounded only in the transcript.
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

- [ ] **Step 6: Create a minimal CLI main (prints the prompt for now)**

Create `src-tauri/wisper-summarize/src/main.rs`:

```rust
//! `wisper-summarize` — runs the local LLM summary in its own process so its
//! llama.cpp ggml never clashes with the main app's whisper.cpp ggml. Reads the
//! transcript from stdin; `--model <path>` and `--language <lang>` from args;
//! writes the markdown summary to stdout. Non-zero exit + stderr on failure.
//!
//! Task 1: this prints the prompt. Task 2 replaces that with real generation.
mod prompt;

use std::io::Read;

fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let model = arg_value(&args, "--model").ok_or("missing --model")?;
    let language = arg_value(&args, "--language").unwrap_or_else(|| "auto".to_string());
    let _ = &model; // used in Task 2 (load the GGUF)

    let mut transcript = String::new();
    std::io::stdin()
        .read_to_string(&mut transcript)
        .map_err(|e| format!("read stdin: {e}"))?;
    if transcript.trim().is_empty() {
        return Err("empty transcript".to_string());
    }

    // Task 2 will load the model and generate; for now emit the prompt so the
    // CLI is end-to-end testable.
    print!("{}", prompt::build_prompt(&transcript, &language));
    Ok(())
}

/// Value following `flag` in `args`, if present.
fn arg_value(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1).cloned())
}
```

- [ ] **Step 7: Run tests + build the helper + smoke-test the CLI**

Run: `cd src-tauri && cargo test -p wisper-summarize 2>&1 | tail -10` — 4 pass.
Run: `cd src-tauri && cargo build -p wisper-summarize 2>&1 | tail -3` — compiles (this compiles llama.cpp; slow first time).
Run: `echo 'Você: bom dia' | src-tauri/target/debug/wisper-summarize --model /tmp/x --language pt` — prints the prompt containing "Você: bom dia" and the four section headers.

- [ ] **Step 8: Format + commit**

```bash
cd src-tauri && cargo fmt
cd /Users/hudsonbrendon/Github/openwispr
git add src-tauri/Cargo.toml src-tauri/wisper-summarize
git commit -m "feat(summarize): workspace helper crate with the pure prompt + CLI skeleton"
```

---

## Task 2: Helper LLM generation (move llama into the helper)

Move the llama.cpp load+generate logic (currently in `src-tauri/src/summarizer.rs`'s `Summarizer`) into the helper's `main`, so the CLI actually summarizes. Native, manual verify.

**Files:**

- Modify: `src-tauri/wisper-summarize/src/main.rs`
- Create: `src-tauri/wisper-summarize/src/llm.rs`

**Interfaces:**

- Consumes: `prompt::build_prompt`.
- Produces: `llm::summarize(model_path: &str, transcript: &str, language: &str) -> Result<String, String>`.

- [ ] **Step 1: Move the llama logic into `llm.rs`**

Create `src-tauri/wisper-summarize/src/llm.rs` with the generation logic. PORT the body of `Summarizer::load` + `Summarizer::summarize` from the current `src-tauri/src/summarizer.rs` (verified working against llama-cpp-2 0.1.150), as a single function that loads, generates, and drops the model:

```rust
//! llama.cpp summary generation (isolated in this helper process).
use crate::prompt::build_prompt;
// Same llama-cpp-2 0.1.150 imports/types the original Summarizer used; port them
// from the prior src-tauri/src/summarizer.rs verbatim (LlamaBackend, LlamaModel,
// LlamaContextParams, LlamaBatch, LlamaSampler, token_to_piece w/ encoding_rs, etc.)

/// Load the GGUF, generate the structured summary, return markdown. The model is
/// loaded and dropped within this call (one-shot process).
pub fn summarize(model_path: &str, transcript: &str, language: &str) -> Result<String, String> {
    // 1. let prompt = build_prompt(transcript, language);
    // 2. LlamaBackend::init(); LlamaModel::load_from_file(model_path, n_gpu_layers=large);
    // 3. apply chat template (fallback to raw prompt); tokenize; LlamaBatch decode;
    //    greedy sample loop (LlamaSampler::greedy + sample + accept), stop on EOG,
    //    detokenize via token_to_piece + encoding_rs::Decoder, bounded by MAX_NEW_TOKENS.
    // 4. return the generated markdown (trimmed).
    // PORT THIS verbatim from the prior working Summarizer::load + ::summarize.
    todo!("port from prior src-tauri/src/summarizer.rs Summarizer::{load,summarize}")
}
```

> The implementer ports the EXACT working body from the prior `src-tauri/src/summarizer.rs` (it compiled + was reviewed against 0.1.150). Replace the `todo!()` with that real code. The only structural change: it's one function (load+generate+drop) instead of a struct, and it lives in the helper.

- [ ] **Step 2: Wire `main` to call `llm::summarize`**

In `src-tauri/wisper-summarize/src/main.rs`, add `mod llm;`, and replace the prompt-printing line in `run()`:

```rust
    let markdown = llm::summarize(&model, &transcript, &language)?;
    print!("{markdown}");
```

(Remove the now-unused `let _ = &model;`.)

- [ ] **Step 3: Build + smoke test**

Run: `cd src-tauri && cargo build -p wisper-summarize 2>&1 | tail -5` — compiles cleanly.
Run (only if the GGUF is present at its model path — find it via the app data dir `~/Library/Application Support/chat.wisper/models/qwen2.5-7b-instruct-q4_k_m.gguf`):
`echo 'Você: vamos lançar terça. Maria fecha o relatório.' | src-tauri/target/debug/wisper-summarize --model "<gguf path>" --language pt`
Expected: prints a markdown summary with the four sections. If the model isn't downloaded yet, skip — functional verify is Task 6; record that it compiles.

- [ ] **Step 4: Format + commit**

```bash
cd src-tauri && cargo fmt
cd /Users/hudsonbrendon/Github/openwispr
git add src-tauri/wisper-summarize
git commit -m "feat(summarize): real llama.cpp generation in the helper process"
```

---

## Task 3: Remove llama from the main app (un-corrupt whisper)

Delete the in-process `Summarizer` + llama deps from `src-tauri`. This is the fix that restores whisper. The `generate_summary` command is temporarily stubbed to `Err("summary_unavailable")` here; Task 5 wires the sidecar.

**Files:**

- Delete: `src-tauri/src/summarizer.rs`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/src/commands.rs`

**Interfaces:**

- Produces: `src-tauri` with NO `llama-cpp-2`/`encoding_rs`; whisper restored.

- [ ] **Step 1: Remove llama deps from the main app**

In `src-tauri/Cargo.toml`, REMOVE the `encoding_rs = "0.8"` line and BOTH `llama-cpp-2` lines (the macOS-block one and the non-macOS-block one). Leave `[workspace]` + everything else.

- [ ] **Step 2: Delete the in-process summarizer**

```bash
git rm src-tauri/src/summarizer.rs
```

In `src-tauri/src/lib.rs`, remove the `mod summarizer;` line.

- [ ] **Step 3: Temporarily stub generate_summary**

In `src-tauri/src/commands.rs`, replace the body of `generate_summary` (which references `crate::summarizer::Summarizer`) with a temporary stub so the crate compiles WITHOUT llama (Task 5 implements the sidecar spawn):

```rust
/// Generate the AI summary for a meeting. (Sidecar spawn wired in Task 5.)
#[tauri::command]
pub async fn generate_summary(app: AppHandle, id: String) -> Result<String, String> {
    let _ = (&app, &id);
    Err("summary_unavailable".to_string())
}
```

Keep `llm_model_downloaded` and `download_llm_model` as-is (they use `model_manager`, not llama).

- [ ] **Step 4: Build + verify whisper is back + suite + clippy**

Run: `cd src-tauri && cargo build 2>&1 | tail -5` — compiles WITHOUT llama-cpp-2 (verify it's not in the dep tree: `cargo tree -p wisper 2>/dev/null | grep -c llama-cpp` → 0).
Run: `cd src-tauri && cargo test 2>&1 | tail -5` — green.
Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings 2>&1 | tail -8` — clean.

- [ ] **Step 5: Format + commit**

```bash
cd src-tauri && cargo fmt
cd /Users/hudsonbrendon/Github/openwispr
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/src/commands.rs
git commit -m "fix(summary): drop in-process llama from the app to restore whisper"
```

---

## Task 4: Sidecar build pipeline + bundling

Build the helper and bundle it as a Tauri `externalBin` sidecar. Verified by inspecting the bundled `.app`.

**Files:**

- Create: `scripts/before-build.sh`
- Modify: `src-tauri/tauri.conf.json`
- Create: `src-tauri/binaries/.gitignore` (ignore the generated triple-named binary)

**Interfaces:**

- Produces: the bundled `.app` contains the `wisper-summarize` sidecar next to the main binary.

- [ ] **Step 1: Write the before-build script**

Create `scripts/before-build.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Build the summary sidecar and stage it for Tauri's externalBin (which expects
# binaries/<name>-<target-triple>). Then run the frontend build.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TRIPLE="$(rustc -Vv | sed -n 's/^host: //p')"
( cd src-tauri && cargo build --release -p wisper-summarize )
mkdir -p src-tauri/binaries
cp "src-tauri/target/release/wisper-summarize" "src-tauri/binaries/wisper-summarize-${TRIPLE}"
pnpm build
```

Make it executable: `chmod +x scripts/before-build.sh`.

- [ ] **Step 2: Point Tauri at the script + declare the sidecar**

In `src-tauri/tauri.conf.json`:

- Change `"beforeBuildCommand": "pnpm build"` to `"beforeBuildCommand": "bash scripts/before-build.sh"`.
- In the `"bundle"` object, add `"externalBin": ["binaries/wisper-summarize"]`.

- [ ] **Step 3: Ignore the generated binary**

Create `src-tauri/binaries/.gitignore`:

```
*
!.gitignore
```

(The triple-named binary is a build artifact, regenerated each build.)

- [ ] **Step 4: Build + verify the sidecar is bundled (manual)**

Run the signed build (per the project workflow): `APPLE_SIGNING_IDENTITY="OpenWispr Dev" pnpm tauri build 2>&1 | tail -5`.
Verify the sidecar landed next to the main binary:
`ls -l src-tauri/target/release/bundle/macos/Wisper.app/Contents/MacOS/` — expect both `wisper` and `wisper-summarize`.
Verify it's signed: `codesign -dv src-tauri/target/release/bundle/macos/Wisper.app/Contents/MacOS/wisper-summarize 2>&1 | grep -i identifier`.
(This task's gate is that the build bundles + signs the sidecar; functional run is Task 6.)

- [ ] **Step 5: Commit**

```bash
cd /Users/hudsonbrendon/Github/openwispr
git add scripts/before-build.sh src-tauri/tauri.conf.json src-tauri/binaries/.gitignore
git commit -m "build(summary): build + bundle the wisper-summarize sidecar"
```

---

## Task 5: Spawn the sidecar from generate_summary

Rewrite `generate_summary` to resolve the bundled sidecar path and run it: model path + language as args, transcript on stdin, markdown from stdout.

**Files:**

- Modify: `src-tauri/src/commands.rs`

**Interfaces:**

- Consumes: `meetings::{get,save,transcript_text}`, `model_manager::{llm_model_info,is_present,model_path}`, the bundled `wisper-summarize` sidecar.
- Produces: `generate_summary(app, id) -> Result<String, String>` (real).

- [ ] **Step 1: Add a sidecar-path helper + rewrite generate_summary**

In `src-tauri/src/commands.rs`, replace the stub `generate_summary` with:

```rust
/// Path to the bundled `wisper-summarize` sidecar (next to the main binary in
/// the .app). In dev (`tauri dev`) it falls back to the workspace debug build.
fn summarize_sidecar_path() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let dir = exe.parent().ok_or("no exe dir")?;
    let bundled = dir.join("wisper-summarize");
    if bundled.exists() {
        return Ok(bundled);
    }
    // dev fallback: target/{debug,release}/wisper-summarize
    for profile in ["debug", "release"] {
        let p = dir.join("..").join(profile).join("wisper-summarize");
        if p.exists() {
            return Ok(p);
        }
    }
    Err("summarize sidecar not found".to_string())
}

/// Generate (or regenerate) the structured AI summary for a meeting by running
/// the isolated `wisper-summarize` sidecar, save it, and return the markdown.
/// Errors: "no_llm_model", "empty_transcript", "summary_unavailable".
#[tauri::command]
pub async fn generate_summary(app: AppHandle, id: String) -> Result<String, String> {
    let data_dir = app.state::<AppState>().data_dir.clone();
    let mut meeting = crate::meetings::get(&data_dir, &id).ok_or("meeting not found")?;
    let transcript = crate::meetings::transcript_text(&meeting);
    if transcript.trim().is_empty() {
        return Err("empty_transcript".to_string());
    }
    if !model_manager::is_present(&data_dir, model_manager::llm_model_info()) {
        return Err("no_llm_model".to_string());
    }
    let language = meeting.language.clone();
    let model_path = model_manager::model_path(&data_dir, model_manager::llm_model_info());
    let sidecar = summarize_sidecar_path()?;

    // Run the sidecar off the async runtime (it's CPU/GPU heavy + blocking I/O).
    let markdown = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut child = Command::new(&sidecar)
            .arg("--model")
            .arg(&model_path)
            .arg("--language")
            .arg(&language)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn summarize: {e}"))?;
        child
            .stdin
            .take()
            .ok_or("no child stdin")?
            .write_all(transcript.as_bytes())
            .map_err(|e| format!("write transcript: {e}"))?;
        let out = child
            .wait_with_output()
            .map_err(|e| format!("wait summarize: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "summarize failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    })
    .await
    .map_err(|e| format!("summary task: {e}"))??;

    if markdown.is_empty() {
        return Err("summary_unavailable".to_string());
    }
    meeting.summary = Some(markdown.clone());
    if let Err(e) = crate::meetings::save(&data_dir, &meeting) {
        eprintln!("save summary failed: {e}");
    }
    Ok(markdown)
}
```

- [ ] **Step 2: Build + suite + clippy**

Run: `cd src-tauri && cargo build 2>&1 | tail -5` — compiles (still no llama in the main app: `cargo tree -p wisper | grep -c llama-cpp` → 0).
Run: `cd src-tauri && cargo test 2>&1 | tail -5` — green.
Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings 2>&1 | tail -8` — clean.

- [ ] **Step 3: Format + commit**

```bash
cd src-tauri && cargo fmt
cd /Users/hudsonbrendon/Github/openwispr
git add src-tauri/src/commands.rs
git commit -m "feat(summary): generate_summary spawns the isolated sidecar"
```

---

## Task 6: End-to-end manual verification + docs

**Files:**

- Modify: `README.md` (only if the prior summary doc needs a tweak; otherwise no change)

- [ ] **Step 1: Full automated verification**

Run: `cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings 2>&1 | tail -8 && cargo test 2>&1 | tail -5` (all green; `cargo tree -p wisper | grep -c llama-cpp` → 0).
Run: `cd /Users/hudsonbrendon/Github/openwispr && pnpm lint && pnpm test 2>&1 | tail -5 && git ls-files | grep -E '\.(md|ts|tsx|json)$' | xargs npx prettier --check`.

- [ ] **Step 2: Build + reinstall (project workflow)**

`APPLE_SIGNING_IDENTITY="OpenWispr Dev" pnpm tauri build`, reinstall to `/Applications`, per the project's rebuild/reinstall workflow. Confirm the `.app/Contents/MacOS/` has both `wisper` and `wisper-summarize`.

- [ ] **Step 3: Manual end-to-end checklist (the critical regression + the feature)**

- **Whisper restored:** start a NEW meeting, speak → the LIVE transcript shows again (this is the regression fix — whisper works now that llama isn't linked). Stop → the saved transcript has segments.
- Dictation by hotkey works (whisper).
- **Summary:** open a meeting → Resumo → (download model if needed) → **Gerar resumo** → the sidecar runs in a separate process → structured summary appears + persists.
- **No cross-contamination:** after generating a summary, start ANOTHER meeting → live transcript STILL works (the sidecar is a separate process that exited; the main app's whisper is untouched).

- [ ] **Step 4: Docs**

The README already documents the local AI summary (prior task). Update only if wording implies in-process; otherwise leave it. If updated, keep tone/language consistent.

- [ ] **Step 5: Commit (if README changed)**

```bash
cd /Users/hudsonbrendon/Github/openwispr
pnpm format
git add README.md
git commit -m "docs: note the summary runs in an isolated process"
```

---

## Self-Review

**1. Spec coverage (revised spec — process isolation):**

- Helper crate links only llama → Task 1/2. ✓
- Main app drops llama, whisper restored → Task 3. ✓
- build_prompt moved to helper → Task 1. ✓
- Sidecar bundling (externalBin + build script) → Task 4. ✓
- generate_summary spawns sidecar (stdin transcript, args model/lang, stdout md) → Task 5. ✓
- Errors no_llm_model/empty_transcript preserved → Task 5. ✓
- Meeting.summary / llm_model_info / frontend unchanged → not re-touched (already on branch). ✓
- Whisper-restored verification → Task 6. ✓
- CI stays llama-free (helper not a default clippy/test target) → Global Constraints + Task 3/5 use `-p wisper`. ✓

**2. Placeholder scan:** Task 2's `llm.rs` has a `todo!()` ONLY as a pointer to "port the verbatim working body from the prior summarizer.rs" — the real code already exists in git history (commit f8afcc7) and must be pasted in; this is a move, not new code. Every other step has complete code.

**3. Type consistency:**

- `prompt::build_prompt`/`truncate_transcript`/`MAX_TRANSCRIPT_CHARS` — Task 1, used by Task 2's `llm::summarize`. ✓
- `llm::summarize(model_path,transcript,language) -> Result<String,String>` — Task 2, called by main. ✓
- `generate_summary(app,id)` command + errors — Task 5; frontend already matches (`no_llm_model`/`empty_transcript`). ✓
- sidecar name `wisper-summarize` consistent across helper bin / externalBin / before-build copy / `summarize_sidecar_path`. ✓
- `model_manager::is_present`/`model_path`/`llm_model_info` — already on branch, consumed in Task 5. ✓
