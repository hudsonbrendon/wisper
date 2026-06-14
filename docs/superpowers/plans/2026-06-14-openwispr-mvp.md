# OpenWispr MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform, local-first push-to-talk voice dictation app: hold a global hotkey, speak, release, and the locally-transcribed (whisper.cpp) text is injected into the focused application.

**Architecture:** A single Tauri 2 application. All hardware/heavy work lives in a Rust core split into focused modules (`config`, `state`, `model_manager`, `audio`, `stt`, `inject`, plus orchestration in `lib.rs`). A React + Tailwind webview provides a settings window and a frameless always-on-top recording overlay. The Rust core and frontend communicate via Tauri commands (frontend → core) and events (core → frontend).

**Tech Stack:** Rust, Tauri 2, `tauri-plugin-global-shortcut` (push-to-talk), `cpal` (mic), `whisper-rs` (whisper.cpp bindings), `enigo` + `arboard` (text injection / clipboard fallback), `reqwest` + `sha2` (model download/verify), React + TypeScript + Vite + Tailwind CSS (UI).

**Reference spec:** `docs/superpowers/specs/2026-06-14-openwispr-design.md`

---

## Conventions

- **Working directory:** `~/Github/openwispr` (already a git repo on branch `main`).
- **Rust core lives in:** `src-tauri/` (Tauri convention). Modules under `src-tauri/src/`.
- **Frontend lives in:** repo root (`src/`, `index.html`, `vite.config.ts`) per `create-tauri-app`.
- **Run Rust tests:** `cd src-tauri && cargo test`.
- **Run the app in dev:** `pnpm tauri dev` from the repo root.
- **Toolchain:** assumes `rustup`, `pnpm`, and `cargo` are installed. macOS is the primary dev machine for this plan; commands are bash.
- **Dependency versions:** use `cargo add <crate>` and `pnpm add <pkg>` so the latest compatible version is pinned automatically. Do not hand-write version numbers.

## File Structure

Files created by this plan and their single responsibility:

| File | Responsibility |
|---|---|
| `LICENSE` | MIT license text |
| `README.md` | Project intro, build instructions |
| `src-tauri/src/config.rs` | `Config` struct, load/save TOML, defaults (pure + fs) |
| `src-tauri/src/state.rs` | `State`/`Event` enums + pure `next()` transition fn |
| `src-tauri/src/model_manager.rs` | Whisper model catalog, SHA-256 verify (pure), async download |
| `src-tauri/src/audio.rs` | `to_mono` + `resample_to_16k` (pure) + cpal capture handle |
| `src-tauri/src/stt.rs` | whisper-rs wrapper: load model, transcribe buffer → String |
| `src-tauri/src/inject.rs` | enigo type + arboard clipboard-paste fallback |
| `src-tauri/src/commands.rs` | Tauri command handlers (frontend → core) |
| `src-tauri/src/lib.rs` | App setup: state, tray, hotkey wiring, orchestration |
| `src-tauri/src/main.rs` | Thin entry point calling `lib.rs` run() |
| `src-tauri/tests/fixtures/jfk.wav` | Short speech fixture for the ignored STT test |
| `src/lib/api.ts` | Typed wrappers over Tauri commands/events |
| `src/routes/Settings.tsx` | Settings UI |
| `src/routes/Overlay.tsx` | Recording overlay UI |
| `src/App.tsx` | Routes between Settings and Overlay by window label |

---

## Task 1: Project scaffold, license, gitignore

**Files:**
- Create: `LICENSE`, `README.md`, `.gitignore`, and the full `create-tauri-app` scaffold (`src-tauri/`, `src/`, `package.json`, `vite.config.ts`, etc.)

- [ ] **Step 1: Scaffold the Tauri 2 app (React + TypeScript + Vite)**

Run from the repo root. The scaffold tool will create files alongside the existing `docs/` directory.

```bash
cd ~/Github/openwispr
pnpm create tauri-app . --template react-ts --manager pnpm --yes
pnpm install
```

If the tool refuses because the directory is non-empty, scaffold into a temp dir and move files in:

```bash
cd ~/Github/openwispr
pnpm create tauri-app openwispr-scaffold --template react-ts --manager pnpm --yes
cp -R openwispr-scaffold/. .
rm -rf openwispr-scaffold
pnpm install
```

- [ ] **Step 2: Verify the dev app builds and launches**

Run: `pnpm tauri dev`
Expected: a native window opens showing the default Tauri + React welcome page. Close it (Ctrl+C in terminal) to continue.

- [ ] **Step 3: Add the MIT LICENSE**

Create `LICENSE` (replace `<YEAR>` with 2026, `<AUTHOR>` with the repo owner's name):

```text
MIT License

Copyright (c) 2026 Hudson Brendon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Write README.md**

Create `README.md`:

```markdown
# OpenWispr

Open-source, local-first voice dictation. Hold a hotkey, speak, release — your
words are transcribed on-device with Whisper and typed into whatever app you're
using. An open alternative to Wispr Flow. No cloud, no account.

## Status

MVP in development. See `docs/superpowers/specs/2026-06-14-openwispr-design.md`.

## Develop

```bash
pnpm install
pnpm tauri dev
```

## Test

```bash
cd src-tauri && cargo test
```

## License

MIT
```

- [ ] **Step 5: Ensure .gitignore covers build artifacts**

Append to `.gitignore` (create if the scaffold did not):

```gitignore
# Rust
/src-tauri/target/
# Node
node_modules/
dist/
# OpenWispr runtime data downloaded at runtime, never commit models
*.bin
```

- [ ] **Step 6: Commit**

```bash
cd ~/Github/openwispr
git add -A
git commit -m "chore: scaffold Tauri 2 + React app, add MIT license and README"
```

---

## Task 2: Tailwind CSS baseline

**Files:**
- Modify: `package.json` (deps), `src/main.tsx` or `src/index.css` (Tailwind directives), `vite.config.ts`
- Create: `tailwind.config.js`, `postcss.config.js`

- [ ] **Step 1: Install Tailwind**

```bash
cd ~/Github/openwispr
pnpm add -D tailwindcss@^3 postcss autoprefixer
pnpm exec tailwindcss init -p
```

- [ ] **Step 2: Configure content globs**

Replace `tailwind.config.js` with:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 3: Add Tailwind directives to the global stylesheet**

Replace the contents of `src/index.css` (create it if absent and import it in `src/main.tsx`) with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; margin: 0; }
```

Ensure `src/main.tsx` imports it: `import "./index.css";`

- [ ] **Step 4: Verify Tailwind compiles**

Temporarily set the body of `src/App.tsx`'s returned JSX to:

```tsx
<div className="grid h-full place-items-center bg-zinc-900 text-zinc-100">
  <h1 className="text-2xl font-semibold">OpenWispr</h1>
</div>
```

Run: `pnpm tauri dev`
Expected: a dark window with centered white "OpenWispr" text (proves Tailwind classes apply). Close it.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: add Tailwind CSS baseline"
```

---

## Task 3: Config module (TDD)

**Files:**
- Create: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod config;`)

- [ ] **Step 1: Add dependencies**

```bash
cd ~/Github/openwispr/src-tauri
cargo add serde --features derive
cargo add toml
```

- [ ] **Step 2: Write the failing test**

Create `src-tauri/src/config.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InjectMethod {
    Type,
    Paste,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Config {
    /// Global hotkey accelerator string, e.g. "Alt+Space".
    pub hotkey: String,
    /// Whisper model id from the catalog, e.g. "base.en".
    pub model_id: String,
    /// Input device name; None means the system default device.
    pub mic_device: Option<String>,
    /// Whisper language code, e.g. "en", "pt", or "auto".
    pub language: String,
    /// How transcribed text is inserted into the focused app.
    pub inject_method: InjectMethod,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            hotkey: "Alt+Space".to_string(),
            model_id: "base.en".to_string(),
            mic_device: None,
            language: "en".to_string(),
            inject_method: InjectMethod::Type,
        }
    }
}

impl Config {
    /// Serialize to TOML text.
    pub fn to_toml(&self) -> Result<String, toml::ser::Error> {
        toml::to_string_pretty(self)
    }

    /// Parse from TOML text, falling back to defaults for the whole struct
    /// only if parsing fails entirely.
    pub fn from_toml(text: &str) -> Self {
        toml::from_str(text).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_toml() {
        let cfg = Config {
            hotkey: "Ctrl+Shift+D".to_string(),
            model_id: "small".to_string(),
            mic_device: Some("MacBook Pro Microphone".to_string()),
            language: "pt".to_string(),
            inject_method: InjectMethod::Paste,
        };
        let text = cfg.to_toml().expect("serialize");
        let parsed = Config::from_toml(&text);
        assert_eq!(cfg, parsed);
    }

    #[test]
    fn invalid_toml_falls_back_to_default() {
        let parsed = Config::from_toml("this is not valid toml :::");
        assert_eq!(parsed, Config::default());
    }
}
```

- [ ] **Step 3: Register the module**

In `src-tauri/src/lib.rs`, add near the top (after any existing `mod` lines):

```rust
mod config;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/Github/openwispr/src-tauri && cargo test config`
Expected: `round_trips_through_toml` and `invalid_toml_falls_back_to_default` both PASS.

- [ ] **Step 5: Add path + load/save helpers**

Append to `src-tauri/src/config.rs` (before the `#[cfg(test)]` block):

```rust
use std::path::PathBuf;

/// Returns the on-disk config file path inside the given app config dir.
/// (The caller passes the dir so this stays testable and OS-agnostic.)
pub fn config_path(app_config_dir: &std::path::Path) -> PathBuf {
    app_config_dir.join("config.toml")
}

/// Load config from `app_config_dir/config.toml`, returning defaults if the
/// file does not exist.
pub fn load(app_config_dir: &std::path::Path) -> Config {
    let path = config_path(app_config_dir);
    match std::fs::read_to_string(&path) {
        Ok(text) => Config::from_toml(&text),
        Err(_) => Config::default(),
    }
}

/// Save config to `app_config_dir/config.toml`, creating the dir if needed.
pub fn save(app_config_dir: &std::path::Path, cfg: &Config) -> std::io::Result<()> {
    std::fs::create_dir_all(app_config_dir)?;
    let text = cfg
        .to_toml()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    std::fs::write(config_path(app_config_dir), text)
}
```

- [ ] **Step 6: Add a load/save round-trip test**

Add inside the `tests` module in `src-tauri/src/config.rs`:

```rust
    #[test]
    fn load_returns_default_when_missing() {
        let dir = std::env::temp_dir().join("openwispr_test_missing_cfg");
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(load(&dir), Config::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = std::env::temp_dir().join("openwispr_test_save_load");
        let _ = std::fs::remove_dir_all(&dir);
        let mut cfg = Config::default();
        cfg.language = "pt".to_string();
        save(&dir, &cfg).expect("save");
        assert_eq!(load(&dir), cfg);
        let _ = std::fs::remove_dir_all(&dir);
    }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd ~/Github/openwispr/src-tauri && cargo test config`
Expected: all four config tests PASS.

- [ ] **Step 8: Commit**

```bash
cd ~/Github/openwispr
git add -A
git commit -m "feat: config module with TOML load/save and defaults"
```

---

## Task 4: State machine (TDD)

**Files:**
- Create: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod state;`)

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/state.rs`:

```rust
/// The dictation lifecycle. Pure data — no I/O lives here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Idle,
    Recording,
    Transcribing,
    Injecting,
}

/// Events that drive transitions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Event {
    HotkeyPressed,
    HotkeyReleased,
    TranscriptionDone,
    InjectionDone,
    /// Any failure returns the machine to Idle.
    Error,
}

/// Pure transition function. Unknown (state, event) pairs leave the state
/// unchanged so stray events can never corrupt the machine.
pub fn next(state: State, event: Event) -> State {
    use Event::*;
    use State::*;
    match (state, event) {
        (Idle, HotkeyPressed) => Recording,
        (Recording, HotkeyReleased) => Transcribing,
        (Transcribing, TranscriptionDone) => Injecting,
        (Injecting, InjectionDone) => Idle,
        (_, Error) => Idle,
        // Any other pairing is a no-op.
        (s, _) => s,
    }
}

/// Lowercase label used in events sent to the frontend.
pub fn label(state: State) -> &'static str {
    match state {
        State::Idle => "idle",
        State::Recording => "recording",
        State::Transcribing => "transcribing",
        State::Injecting => "injecting",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn happy_path_cycles_back_to_idle() {
        let mut s = State::Idle;
        s = next(s, Event::HotkeyPressed);
        assert_eq!(s, State::Recording);
        s = next(s, Event::HotkeyReleased);
        assert_eq!(s, State::Transcribing);
        s = next(s, Event::TranscriptionDone);
        assert_eq!(s, State::Injecting);
        s = next(s, Event::InjectionDone);
        assert_eq!(s, State::Idle);
    }

    #[test]
    fn error_from_any_state_returns_to_idle() {
        for s in [State::Recording, State::Transcribing, State::Injecting] {
            assert_eq!(next(s, Event::Error), State::Idle);
        }
    }

    #[test]
    fn stray_events_are_no_ops() {
        // Releasing while idle does nothing.
        assert_eq!(next(State::Idle, Event::HotkeyReleased), State::Idle);
        // Pressing again while recording does nothing.
        assert_eq!(next(State::Recording, Event::HotkeyPressed), State::Recording);
    }

    #[test]
    fn labels_are_stable() {
        assert_eq!(label(State::Idle), "idle");
        assert_eq!(label(State::Recording), "recording");
        assert_eq!(label(State::Transcribing), "transcribing");
        assert_eq!(label(State::Injecting), "injecting");
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/lib.rs`, add:

```rust
mod state;
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd ~/Github/openwispr/src-tauri && cargo test state`
Expected: all four state tests PASS.

- [ ] **Step 4: Commit**

```bash
cd ~/Github/openwispr
git add -A
git commit -m "feat: pure dictation state machine"
```

---

## Task 5: Model manager — catalog + SHA-256 verify (TDD) + download

**Files:**
- Create: `src-tauri/src/model_manager.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod model_manager;`)

- [ ] **Step 1: Add dependencies**

```bash
cd ~/Github/openwispr/src-tauri
cargo add sha2
cargo add reqwest --no-default-features --features "rustls-tls,stream"
cargo add futures-util
cargo add tokio --features "fs,io-util"
```

- [ ] **Step 2: Write the catalog + verify with a failing test**

Create `src-tauri/src/model_manager.rs`:

```rust
use sha2::{Digest, Sha256};

/// A downloadable Whisper ggml model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelInfo {
    pub id: &'static str,
    pub filename: &'static str,
    pub url: &'static str,
    /// Lowercase hex SHA-256 of the downloaded file.
    pub sha256: &'static str,
}

/// The models we offer. SHA-256 values are the published hashes from the
/// ggml-org/whisper.cpp Hugging Face repo. Verify against the repo before
/// trusting a new entry.
pub fn catalog() -> &'static [ModelInfo] {
    &[
        ModelInfo {
            id: "base.en",
            filename: "ggml-base.en.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
            sha256: "137c40403d78fd54d454da0f9bd998f78703390c", // placeholder — see Step 3
        },
    ]
}

/// Look up a model by id.
pub fn find(id: &str) -> Option<&'static ModelInfo> {
    catalog().iter().find(|m| m.id == id)
}

/// True if `bytes` hashes to `expected` (case-insensitive hex).
pub fn verify_sha256(bytes: &[u8], expected: &str) -> bool {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let actual = hasher.finalize();
    let actual_hex = actual.iter().map(|b| format!("{b:02x}")).collect::<String>();
    actual_hex.eq_ignore_ascii_case(expected)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verify_matches_known_hash() {
        // SHA-256 of the bytes "hello" is well-known.
        let expected = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        assert!(verify_sha256(b"hello", expected));
    }

    #[test]
    fn verify_rejects_wrong_hash() {
        assert!(!verify_sha256(b"hello", "0000000000000000000000000000000000000000000000000000000000000000"));
    }

    #[test]
    fn catalog_ids_are_findable() {
        assert!(find("base.en").is_some());
        assert!(find("does-not-exist").is_none());
    }
}
```

- [ ] **Step 3: Register module and correct the real SHA-256**

In `src-tauri/src/lib.rs`, add:

```rust
mod model_manager;
```

Then replace the placeholder `sha256` for `base.en` with the real hash. Compute it once by downloading the file and hashing it:

```bash
cd /tmp
curl -L -o ggml-base.en.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
shasum -a 256 ggml-base.en.bin
```

Copy the printed 64-char hex digest into the `sha256` field of the `base.en` entry in `catalog()`, replacing the placeholder. (Keep `/tmp/ggml-base.en.bin` — Task 8/13 smoke tests can reuse it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/Github/openwispr/src-tauri && cargo test model_manager`
Expected: `verify_matches_known_hash`, `verify_rejects_wrong_hash`, `catalog_ids_are_findable` all PASS.

- [ ] **Step 5: Add the async download function**

Append to `src-tauri/src/model_manager.rs` (before the `#[cfg(test)]` block):

```rust
use std::path::{Path, PathBuf};

/// Returns the on-disk path for a model inside the given app-data dir.
pub fn model_path(app_data_dir: &Path, info: &ModelInfo) -> PathBuf {
    app_data_dir.join("models").join(info.filename)
}

/// True if the model file exists and matches its expected hash.
pub fn is_downloaded(app_data_dir: &Path, info: &ModelInfo) -> bool {
    let path = model_path(app_data_dir, info);
    match std::fs::read(&path) {
        Ok(bytes) => verify_sha256(&bytes, info.sha256),
        Err(_) => false,
    }
}

/// Download `info` into the app-data dir, invoking `on_progress(received, total)`
/// as bytes arrive, then verify the hash. Returns the final path.
pub async fn download<F>(
    app_data_dir: &Path,
    info: &ModelInfo,
    mut on_progress: F,
) -> Result<PathBuf, String>
where
    F: FnMut(u64, u64),
{
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let dir = app_data_dir.join("models");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create models dir: {e}"))?;
    let final_path = dir.join(info.filename);
    let tmp_path = dir.join(format!("{}.part", info.filename));

    let resp = reqwest::get(info.url)
        .await
        .map_err(|e| format!("request: {e}"))?;
    let total = resp.content_length().unwrap_or(0);
    let mut received: u64 = 0;
    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("create tmp: {e}"))?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download chunk: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("write chunk: {e}"))?;
        received += chunk.len() as u64;
        on_progress(received, total);
    }
    file.flush().await.map_err(|e| format!("flush: {e}"))?;
    drop(file);

    let bytes = tokio::fs::read(&tmp_path)
        .await
        .map_err(|e| format!("read tmp for verify: {e}"))?;
    if !verify_sha256(&bytes, info.sha256) {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err("hash mismatch after download".to_string());
    }
    tokio::fs::rename(&tmp_path, &final_path)
        .await
        .map_err(|e| format!("rename: {e}"))?;
    Ok(final_path)
}
```

- [ ] **Step 6: Verify it still compiles and unit tests pass**

Run: `cd ~/Github/openwispr/src-tauri && cargo test model_manager`
Expected: the three unit tests still PASS (download is exercised later by smoke test in Task 13).

- [ ] **Step 7: Commit**

```bash
cd ~/Github/openwispr
git add -A
git commit -m "feat: model manager with catalog, SHA-256 verify, and streaming download"
```

---

## Task 6: Audio — pure DSP helpers (TDD) + cpal capture

**Files:**
- Create: `src-tauri/src/audio.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod audio;`)

- [ ] **Step 1: Add cpal**

```bash
cd ~/Github/openwispr/src-tauri
cargo add cpal
```

- [ ] **Step 2: Write the pure DSP helpers with failing tests**

Create `src-tauri/src/audio.rs`:

```rust
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
        // L,R,L,R -> avg pairs
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
        // 32kHz -> 16kHz should roughly halve the sample count.
        let s: Vec<f32> = (0..100).map(|i| i as f32).collect();
        let out = resample_to_16k(&s, 32_000);
        assert_eq!(out.len(), 50);
    }

    #[test]
    fn rms_of_silence_is_zero() {
        assert_eq!(rms_level(&[0.0, 0.0, 0.0]), 0.0);
        assert_eq!(rms_level(&[]), 0.0);
    }
}
```

- [ ] **Step 3: Register the module**

In `src-tauri/src/lib.rs`, add:

```rust
mod audio;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/Github/openwispr/src-tauri && cargo test audio`
Expected: all five audio tests PASS.

- [ ] **Step 5: Add the cpal capture recorder**

Append to `src-tauri/src/audio.rs` (before the `#[cfg(test)]` block):

```rust
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};

/// List input device names available on the system.
pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    match host.input_devices() {
        Ok(devices) => devices.filter_map(|d| d.name().ok()).collect(),
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
        let device = match device_name {
            Some(name) => host
                .input_devices()
                .map_err(|e| format!("enumerate devices: {e}"))?
                .find(|d| d.name().map(|n| n == name).unwrap_or(false))
                .ok_or_else(|| format!("input device not found: {name}"))?,
            None => host
                .default_input_device()
                .ok_or_else(|| "no default input device".to_string())?,
        };
        let cfg = device
            .default_input_config()
            .map_err(|e| format!("default input config: {e}"))?;
        let sample_rate = cfg.sample_rate().0;
        let channels = cfg.channels();
        let buffer = Arc::new(Mutex::new(Vec::<f32>::new()));
        let buf_for_cb = buffer.clone();
        let err_fn = |e| eprintln!("audio stream error: {e}");

        let stream = device
            .build_input_stream(
                &cfg.config(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if let Ok(mut b) = buf_for_cb.lock() {
                        b.extend_from_slice(data);
                    }
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("build input stream: {e}"))?;
        stream.play().map_err(|e| format!("play stream: {e}"))?;

        Ok(Recorder {
            stream,
            buffer,
            sample_rate,
            channels,
        })
    }

    /// Current RMS level of captured-so-far audio, for the live meter.
    pub fn level(&self) -> f32 {
        self.buffer.lock().map(|b| rms_level(&b)).unwrap_or(0.0)
    }

    /// Stop capture and return 16 kHz mono samples ready for Whisper.
    pub fn stop(self) -> Vec<f32> {
        drop(self.stream); // halts the callback
        let raw = self.buffer.lock().map(|b| b.clone()).unwrap_or_default();
        let mono = to_mono(&raw, self.channels);
        resample_to_16k(&mono, self.sample_rate)
    }
}
```

- [ ] **Step 6: Verify it compiles**

Run: `cd ~/Github/openwispr/src-tauri && cargo build`
Expected: builds with no errors (the `Recorder` is wired into the app in Task 13).

- [ ] **Step 7: Commit**

```bash
cd ~/Github/openwispr
git add -A
git commit -m "feat: audio module with DSP helpers and cpal recorder"
```

---

## Task 7: STT — whisper-rs wrapper

**Files:**
- Create: `src-tauri/src/stt.rs`, `src-tauri/tests/fixtures/jfk.wav`
- Modify: `src-tauri/src/lib.rs` (add `mod stt;`)

- [ ] **Step 1: Add whisper-rs and a wav reader (for the test)**

```bash
cd ~/Github/openwispr/src-tauri
cargo add whisper-rs
cargo add --dev hound
```

- [ ] **Step 2: Write the transcriber**

Create `src-tauri/src/stt.rs`:

```rust
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

        let num_segments = state
            .full_n_segments()
            .map_err(|e| format!("n_segments: {e}"))?;
        let mut out = String::new();
        for i in 0..num_segments {
            let seg = state
                .full_get_segment_text(i)
                .map_err(|e| format!("segment text: {e}"))?;
            out.push_str(&seg);
        }
        Ok(out.trim().to_string())
    }
}
```

- [ ] **Step 3: Register the module**

In `src-tauri/src/lib.rs`, add:

```rust
mod stt;
```

- [ ] **Step 4: Add the speech fixture**

Download the standard whisper.cpp JFK sample (11 seconds, says "...ask not what your country can do for you..."):

```bash
mkdir -p ~/Github/openwispr/src-tauri/tests/fixtures
curl -L -o ~/Github/openwispr/src-tauri/tests/fixtures/jfk.wav \
  "https://github.com/ggerganov/whisper.cpp/raw/master/samples/jfk.wav"
```

- [ ] **Step 5: Write the ignored integration test**

Create `src-tauri/tests/stt_integration.rs`:

```rust
// Integration test for real Whisper transcription. Ignored by default because
// it needs the downloaded model and is slow/CPU-heavy. Run explicitly with:
//   cargo test --test stt_integration -- --ignored
//
// Requires the base.en model at /tmp/ggml-base.en.bin (downloaded in Task 5).

use openwispr_lib::stt::Transcriber;

#[test]
#[ignore]
fn transcribes_jfk_sample() {
    let model = "/tmp/ggml-base.en.bin";
    let wav_path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/jfk.wav");

    let mut reader = hound::WavReader::open(wav_path).expect("open wav");
    let spec = reader.spec();
    assert_eq!(spec.sample_rate, 16_000, "fixture must be 16kHz");
    // jfk.wav is 16-bit PCM mono.
    let samples: Vec<f32> = reader
        .samples::<i16>()
        .map(|s| s.expect("sample") as f32 / 32768.0)
        .collect();

    let transcriber = Transcriber::load(model).expect("load model");
    let text = transcriber.transcribe(&samples, "en").expect("transcribe");
    let lower = text.to_lowercase();
    assert!(
        lower.contains("country"),
        "expected 'country' in transcript, got: {text}"
    );
}
```

This test depends on `hound` (added as a dev-dependency in Step 1) and on the crate being importable as `openwispr_lib` — set up next.

- [ ] **Step 6: Expose the library name and public modules for integration tests**

Integration tests in `tests/` can only see the crate's public API. In `src-tauri/Cargo.toml`, ensure the `[lib]` section names the crate `openwispr_lib`:

```toml
[lib]
name = "openwispr_lib"
crate-type = ["staticlib", "cdylib", "rlib"]
```

(Keep any existing `crate-type` entries the scaffold added; `rlib` must be present so `tests/` can link it.)

Then in `src-tauri/src/lib.rs`, make the modules used by tests public:

```rust
pub mod stt;
```

(Change `mod stt;` from Step 3 to `pub mod stt;`. Leave the other modules as `mod` unless a test needs them.)

- [ ] **Step 7: Verify it compiles and the ignored test is collected (but skipped)**

Run: `cd ~/Github/openwispr/src-tauri && cargo test`
Expected: compiles; `transcribes_jfk_sample` shows as `ignored` in output, all other tests PASS.

- [ ] **Step 8: Run the ignored test once manually to confirm real transcription**

Run: `cd ~/Github/openwispr/src-tauri && cargo test --test stt_integration -- --ignored`
Expected: PASS (transcript contains "country"). This confirms whisper-rs + model + fixture all work end to end. Takes several seconds.

- [ ] **Step 9: Commit**

```bash
cd ~/Github/openwispr
git add -A
git commit -m "feat: whisper-rs STT wrapper with ignored integration test"
```

---

## Task 8: Inject — enigo type + clipboard-paste fallback

**Files:**
- Create: `src-tauri/src/inject.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod inject;`)

- [ ] **Step 1: Add enigo and arboard**

```bash
cd ~/Github/openwispr/src-tauri
cargo add enigo
cargo add arboard
```

- [ ] **Step 2: Write the inject module**

Create `src-tauri/src/inject.rs`:

```rust
use crate::config::InjectMethod;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};

/// Insert `text` into the currently focused application using the configured
/// method. On `Type` failure, automatically falls back to `Paste`.
pub fn insert(text: &str, method: InjectMethod) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }
    match method {
        InjectMethod::Type => match type_text(text) {
            Ok(()) => Ok(()),
            Err(e) => {
                eprintln!("type failed ({e}); falling back to paste");
                paste_text(text)
            }
        },
        InjectMethod::Paste => paste_text(text),
    }
}

/// Synthesize keystrokes for `text` via enigo.
fn type_text(text: &str) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo init: {e}"))?;
    enigo.text(text).map_err(|e| format!("enigo text: {e}"))
}

/// Copy `text` to the clipboard and send the platform paste shortcut.
fn paste_text(text: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("clipboard: {e}"))?;
    clipboard
        .set_text(text.to_string())
        .map_err(|e| format!("clipboard set: {e}"))?;

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo init: {e}"))?;
    // Cmd on macOS, Ctrl elsewhere.
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;

    enigo
        .key(modifier, Direction::Press)
        .map_err(|e| format!("modifier press: {e}"))?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| format!("v click: {e}"))?;
    enigo
        .key(modifier, Direction::Release)
        .map_err(|e| format!("modifier release: {e}"))?;
    Ok(())
}
```

- [ ] **Step 3: Register the module**

In `src-tauri/src/lib.rs`, add:

```rust
mod inject;
```

- [ ] **Step 4: Verify it compiles**

Run: `cd ~/Github/openwispr/src-tauri && cargo build`
Expected: builds with no errors. (Injection is verified live in Task 13's end-to-end smoke; it cannot be unit-tested because it manipulates the OS focus/keyboard.)

- [ ] **Step 5: Commit**

```bash
cd ~/Github/openwispr
git add -A
git commit -m "feat: text injection via enigo typing with clipboard-paste fallback"
```

---

## Task 9: Tauri commands (frontend → core)

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Define the shared app state and commands**

Create `src-tauri/src/commands.rs`:

```rust
use crate::config::{self, Config};
use crate::model_manager::{self, ModelInfo};
use crate::state::State;
use crate::stt::Transcriber;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// App-wide shared state, behind a Mutex, owned by Tauri.
pub struct AppState {
    pub config: Mutex<Config>,
    pub machine: Mutex<State>,
    /// Loaded model; None until a model is present and loaded.
    pub transcriber: Mutex<Option<Transcriber>>,
    /// Active recorder while in Recording state.
    pub recorder: Mutex<Option<crate::audio::Recorder>>,
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
}

/// Metadata sent to the frontend for each catalog model.
#[derive(serde::Serialize)]
pub struct ModelMeta {
    pub id: String,
    pub filename: String,
    pub downloaded: bool,
}

#[tauri::command]
pub fn get_config(state: tauri::State<AppState>) -> Config {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_config(state: tauri::State<AppState>, new_config: Config) -> Result<(), String> {
    config::save(&state.config_dir, &new_config).map_err(|e| format!("save config: {e}"))?;
    *state.config.lock().unwrap() = new_config;
    Ok(())
}

#[tauri::command]
pub fn list_microphones() -> Vec<String> {
    crate::audio::list_input_devices()
}

#[tauri::command]
pub fn list_models(state: tauri::State<AppState>) -> Vec<ModelMeta> {
    model_manager::catalog()
        .iter()
        .map(|m| ModelMeta {
            id: m.id.to_string(),
            filename: m.filename.to_string(),
            downloaded: model_manager::is_downloaded(&state.data_dir, m),
        })
        .collect()
}

/// Download a model by id, emitting "download_progress" events as it goes,
/// then load it as the active transcriber.
#[tauri::command]
pub async fn download_model(app: AppHandle, id: String) -> Result<(), String> {
    let info: &ModelInfo = model_manager::find(&id).ok_or_else(|| format!("unknown model: {id}"))?;
    let data_dir = app.state::<AppState>().data_dir.clone();

    let app_for_progress = app.clone();
    let path = model_manager::download(&data_dir, info, move |received, total| {
        let _ = app_for_progress.emit(
            "download_progress",
            serde_json::json!({ "id": info.id, "received": received, "total": total }),
        );
    })
    .await?;

    // Load it as the active transcriber.
    let transcriber = Transcriber::load(path.to_str().ok_or("bad model path")?)?;
    *app.state::<AppState>().transcriber.lock().unwrap() = Some(transcriber);
    let _ = app.emit("model_ready", serde_json::json!({ "id": id }));
    Ok(())
}

#[tauri::command]
pub fn get_state(state: tauri::State<AppState>) -> String {
    crate::state::label(*state.machine.lock().unwrap())
}
```

- [ ] **Step 2: Add serde_json (used by command event payloads)**

```bash
cd ~/Github/openwispr/src-tauri
cargo add serde_json
```

- [ ] **Step 3: Register the module and commands in lib.rs**

In `src-tauri/src/lib.rs`, add `mod commands;` with the other modules, and register the command handlers in the builder. The full `lib.rs` wiring is assembled in Task 13; for now just add the module declaration so it compiles:

```rust
mod commands;
```

- [ ] **Step 4: Verify it compiles**

Run: `cd ~/Github/openwispr/src-tauri && cargo build`
Expected: builds with no errors.

- [ ] **Step 5: Commit**

```bash
cd ~/Github/openwispr
git add -A
git commit -m "feat: Tauri commands and shared app state"
```

---

## Task 10: Frontend API layer + window routing

**Files:**
- Create: `src/lib/api.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the Tauri JS API packages**

```bash
cd ~/Github/openwispr
pnpm add @tauri-apps/api
```

- [ ] **Step 2: Write the typed API wrapper**

Create `src/lib/api.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type InjectMethod = "type" | "paste";

export interface Config {
  hotkey: string;
  model_id: string;
  mic_device: string | null;
  language: string;
  inject_method: InjectMethod;
}

export interface ModelMeta {
  id: string;
  filename: string;
  downloaded: boolean;
}

export const getConfig = () => invoke<Config>("get_config");
export const saveConfig = (newConfig: Config) =>
  invoke<void>("save_config", { newConfig });
export const listMicrophones = () => invoke<string[]>("list_microphones");
export const listModels = () => invoke<ModelMeta[]>("list_models");
export const downloadModel = (id: string) =>
  invoke<void>("download_model", { id });
export const getState = () => invoke<string>("get_state");

export type StatePayload = { state: string };
export type LevelPayload = { level: number };
export type TranscriptPayload = { text: string };
export type DownloadProgressPayload = {
  id: string;
  received: number;
  total: number;
};

export const onEvent = <T>(
  name: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> => listen<T>(name, (e) => handler(e.payload));
```

- [ ] **Step 3: Route between Settings and Overlay by window label**

Replace `src/App.tsx` with:

```tsx
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import Settings from "./routes/Settings";
import Overlay from "./routes/Overlay";

export default function App() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    setLabel(getCurrentWindow().label);
  }, []);

  if (label === null) return null;
  return label === "overlay" ? <Overlay /> : <Settings />;
}
```

- [ ] **Step 4: Add placeholder route components so it compiles**

Create `src/routes/Settings.tsx`:

```tsx
export default function Settings() {
  return <div className="p-6 text-zinc-100">Settings</div>;
}
```

Create `src/routes/Overlay.tsx`:

```tsx
export default function Overlay() {
  return <div className="text-zinc-100">Overlay</div>;
}
```

- [ ] **Step 5: Verify it compiles**

Run: `cd ~/Github/openwispr && pnpm tauri dev`
Expected: the window shows "Settings" (the main window's label is `main`, not `overlay`). Close it.

- [ ] **Step 6: Commit**

```bash
cd ~/Github/openwispr
git add -A
git commit -m "feat: frontend API layer and window-label routing"
```

---

## Task 11: Settings UI

**Files:**
- Modify: `src/routes/Settings.tsx`

- [ ] **Step 1: Build the settings form**

Replace `src/routes/Settings.tsx` with:

```tsx
import { useEffect, useState } from "react";
import {
  getConfig,
  saveConfig,
  listMicrophones,
  listModels,
  downloadModel,
  onEvent,
  type Config,
  type ModelMeta,
  type DownloadProgressPayload,
} from "../lib/api";

export default function Settings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [mics, setMics] = useState<string[]>([]);
  const [models, setModels] = useState<ModelMeta[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getConfig().then(setConfig);
    listMicrophones().then(setMics);
    listModels().then(setModels);
    const un = onEvent<DownloadProgressPayload>("download_progress", (p) => {
      const pct = p.total > 0 ? Math.round((p.received / p.total) * 100) : 0;
      setProgress((prev) => ({ ...prev, [p.id]: pct }));
    });
    const unReady = onEvent<{ id: string }>("model_ready", () => {
      listModels().then(setModels);
    });
    return () => {
      un.then((f) => f());
      unReady.then((f) => f());
    };
  }, []);

  if (!config) return <div className="p-6 text-zinc-100">Loading…</div>;

  const update = (patch: Partial<Config>) =>
    setConfig({ ...config, ...patch });

  const onSave = async () => {
    await saveConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="min-h-full bg-zinc-900 p-8 text-zinc-100">
      <h1 className="mb-6 text-2xl font-semibold">OpenWispr</h1>

      <label className="mb-4 block">
        <span className="mb-1 block text-sm text-zinc-400">Hotkey (hold to talk)</span>
        <input
          className="w-full rounded bg-zinc-800 px-3 py-2"
          value={config.hotkey}
          onChange={(e) => update({ hotkey: e.target.value })}
          placeholder="Alt+Space"
        />
      </label>

      <label className="mb-4 block">
        <span className="mb-1 block text-sm text-zinc-400">Microphone</span>
        <select
          className="w-full rounded bg-zinc-800 px-3 py-2"
          value={config.mic_device ?? ""}
          onChange={(e) => update({ mic_device: e.target.value || null })}
        >
          <option value="">System default</option>
          {mics.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </label>

      <label className="mb-4 block">
        <span className="mb-1 block text-sm text-zinc-400">Language</span>
        <input
          className="w-full rounded bg-zinc-800 px-3 py-2"
          value={config.language}
          onChange={(e) => update({ language: e.target.value })}
          placeholder="en, pt, or auto"
        />
      </label>

      <label className="mb-4 block">
        <span className="mb-1 block text-sm text-zinc-400">Insert method</span>
        <select
          className="w-full rounded bg-zinc-800 px-3 py-2"
          value={config.inject_method}
          onChange={(e) =>
            update({ inject_method: e.target.value as Config["inject_method"] })
          }
        >
          <option value="type">Type (synthetic keystrokes)</option>
          <option value="paste">Paste (clipboard + Cmd/Ctrl+V)</option>
        </select>
      </label>

      <div className="mb-6">
        <span className="mb-2 block text-sm text-zinc-400">Models</span>
        {models.map((m) => (
          <div key={m.id} className="mb-2 flex items-center justify-between rounded bg-zinc-800 px-3 py-2">
            <div>
              <span className="font-medium">{m.id}</span>
              <span className="ml-2 text-xs text-zinc-500">
                {m.downloaded ? "downloaded" : "not downloaded"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {progress[m.id] !== undefined && progress[m.id] < 100 && (
                <span className="text-xs text-zinc-400">{progress[m.id]}%</span>
              )}
              <button
                className="rounded bg-indigo-600 px-3 py-1 text-sm hover:bg-indigo-500 disabled:opacity-50"
                disabled={m.downloaded}
                onClick={() => {
                  update({ model_id: m.id });
                  downloadModel(m.id);
                }}
              >
                {m.downloaded ? "Ready" : "Download"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        className="rounded bg-emerald-600 px-4 py-2 font-medium hover:bg-emerald-500"
        onClick={onSave}
      >
        {saved ? "Saved ✓" : "Save settings"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify it renders (commands return real data once wired in Task 13)**

Run: `cd ~/Github/openwispr && pnpm tauri dev`
Expected: the settings form renders. Microphone/model lists populate only after Task 13 wires the commands into the builder; if they're empty now, that's expected. Close it.

- [ ] **Step 3: Commit**

```bash
cd ~/Github/openwispr
git add -A
git commit -m "feat: settings UI form"
```

---

## Task 12: Overlay UI

**Files:**
- Modify: `src/routes/Overlay.tsx`

- [ ] **Step 1: Build the overlay**

Replace `src/routes/Overlay.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { onEvent, type StatePayload, type LevelPayload } from "../lib/api";

export default function Overlay() {
  const [state, setState] = useState("idle");
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const unState = onEvent<StatePayload>("state", (p) => setState(p.state));
    const unLevel = onEvent<LevelPayload>("audio_level", (p) => setLevel(p.level));
    return () => {
      unState.then((f) => f());
      unLevel.then((f) => f());
    };
  }, []);

  const labels: Record<string, string> = {
    idle: "",
    recording: "Listening…",
    transcribing: "Transcribing…",
    injecting: "Inserting…",
  };

  // Scale the meter bar width from RMS level (0..~0.3 typical speech).
  const meterWidth = Math.min(100, Math.round(level * 400));

  return (
    <div className="flex h-full w-full items-center justify-center bg-transparent">
      <div className="flex items-center gap-3 rounded-full bg-zinc-900/90 px-5 py-3 text-zinc-100 shadow-xl backdrop-blur">
        <span
          className={
            "h-3 w-3 rounded-full " +
            (state === "recording" ? "animate-pulse bg-red-500" : "bg-zinc-500")
          }
        />
        <span className="min-w-[90px] text-sm">{labels[state] ?? ""}</span>
        {state === "recording" && (
          <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-700">
            <div
              className="h-full bg-emerald-400 transition-all"
              style={{ width: `${meterWidth}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd ~/Github/openwispr && pnpm build`
Expected: the frontend builds with no TypeScript errors. (The overlay window itself is created in Task 13.)

- [ ] **Step 3: Commit**

```bash
cd ~/Github/openwispr
git add -A
git commit -m "feat: recording overlay UI"
```

---

## Task 13: Wire it all together — windows, tray, hotkey, orchestration

**Files:**
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/main.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add the global-shortcut plugin**

```bash
cd ~/Github/openwispr/src-tauri
cargo add tauri-plugin-global-shortcut
cd ~/Github/openwispr
pnpm add @tauri-apps/plugin-global-shortcut
```

- [ ] **Step 2: Configure windows in tauri.conf.json**

In `src-tauri/tauri.conf.json`, set the `app.windows` array to define the main (settings) window and the overlay window. Replace the existing `windows` array with:

```json
[
  {
    "label": "main",
    "title": "OpenWispr",
    "width": 520,
    "height": 640,
    "resizable": true,
    "visible": true
  },
  {
    "label": "overlay",
    "url": "index.html",
    "width": 260,
    "height": 80,
    "decorations": false,
    "transparent": true,
    "alwaysOnTop": true,
    "skipTaskbar": true,
    "resizable": false,
    "shadow": false,
    "visible": false,
    "focus": false
  }
]
```

- [ ] **Step 3: Grant the overlay transparency on macOS (enable the macOS private API)**

In `src-tauri/tauri.conf.json`, under `app`, add (or set):

```json
"macOSPrivateApi": true
```

- [ ] **Step 4: Write the full lib.rs orchestration**

Replace the entire contents of `src-tauri/src/lib.rs` with:

```rust
mod audio;
mod commands;
mod config;
mod inject;
mod model_manager;
mod state;
pub mod stt;

use commands::AppState;
use state::{Event as SmEvent, State};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Advance the state machine and emit the new state to the overlay.
fn transition(app: &tauri::AppHandle, ev: SmEvent) -> State {
    let app_state = app.state::<AppState>();
    let mut machine = app_state.machine.lock().unwrap();
    *machine = state::next(*machine, ev);
    let label = state::label(*machine);
    let _ = app.emit("state", serde_json::json!({ "state": label }));
    *machine
}

/// Called on hotkey press: start recording, show overlay.
fn on_press(app: &tauri::AppHandle) {
    let new_state = transition(app, SmEvent::HotkeyPressed);
    if new_state != State::Recording {
        return; // stray press while busy
    }
    let app_state = app.state::<AppState>();
    let device = app_state.config.lock().unwrap().mic_device.clone();
    match audio::Recorder::start(device.as_deref()) {
        Ok(rec) => {
            *app_state.recorder.lock().unwrap() = Some(rec);
            if let Some(w) = app.get_webview_window("overlay") {
                let _ = w.show();
            }
            // Spawn a ticker that emits the live mic level while recording.
            let app2 = app.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(100));
                let st = app2.state::<AppState>();
                let guard = st.recorder.lock().unwrap();
                match guard.as_ref() {
                    Some(rec) => {
                        let _ = app2
                            .emit("audio_level", serde_json::json!({ "level": rec.level() }));
                    }
                    None => break,
                }
            });
        }
        Err(e) => {
            eprintln!("recorder start failed: {e}");
            let _ = app.emit("error", serde_json::json!({ "message": e }));
            transition(app, SmEvent::Error);
        }
    }
}

/// Called on hotkey release: stop recording, transcribe, inject, hide overlay.
fn on_release(app: &tauri::AppHandle) {
    let app_state = app.state::<AppState>();
    {
        let machine = app_state.machine.lock().unwrap();
        if *machine != State::Recording {
            return; // nothing to stop
        }
    }
    let recorder = app_state.recorder.lock().unwrap().take();
    let samples = match recorder {
        Some(rec) => rec.stop(),
        None => Vec::new(),
    };
    transition(app, SmEvent::HotkeyReleased); // -> Transcribing

    let app = app.clone();
    // Whisper is CPU-heavy and blocking; run off the UI thread.
    std::thread::spawn(move || {
        let language = app.state::<AppState>().config.lock().unwrap().language.clone();
        let method = app.state::<AppState>().config.lock().unwrap().inject_method;

        let text = {
            let guard = app.state::<AppState>().transcriber.lock().unwrap();
            match guard.as_ref() {
                Some(t) => t.transcribe(&samples, &language),
                None => Err("no model loaded; download one in Settings".to_string()),
            }
        };

        match text {
            Ok(text) => {
                let _ = app.emit("transcript", serde_json::json!({ "text": text }));
                transition(&app, SmEvent::TranscriptionDone); // -> Injecting
                if let Err(e) = inject::insert(&text, method) {
                    eprintln!("inject failed: {e}");
                    let _ = app.emit("error", serde_json::json!({ "message": e }));
                }
                transition(&app, SmEvent::InjectionDone); // -> Idle
            }
            Err(e) => {
                eprintln!("transcribe failed: {e}");
                let _ = app.emit("error", serde_json::json!({ "message": e }));
                transition(&app, SmEvent::Error); // -> Idle
            }
        }
        if let Some(w) = app.get_webview_window("overlay") {
            let _ = w.hide();
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let handle = app.handle();

            // Resolve OS dirs and load config.
            let config_dir = handle.path().app_config_dir().expect("config dir");
            let data_dir = handle.path().app_data_dir().expect("data dir");
            let cfg = config::load(&config_dir);

            // Load the configured model if it is already downloaded.
            let transcriber = model_manager::find(&cfg.model_id)
                .filter(|m| model_manager::is_downloaded(&data_dir, m))
                .and_then(|m| {
                    let path = model_manager::model_path(&data_dir, m);
                    stt::Transcriber::load(path.to_str()?).ok()
                });

            let hotkey = cfg.hotkey.clone();

            app.manage(AppState {
                config: Mutex::new(cfg),
                machine: Mutex::new(State::Idle),
                transcriber: Mutex::new(transcriber),
                recorder: Mutex::new(None),
                config_dir,
                data_dir,
            });

            // Tray with a Settings + Quit menu.
            let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings_item, &quit_item])?;
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "settings" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Register the push-to-talk hotkey with press/release handling.
            let gs = app.global_shortcut();
            gs.on_shortcut(hotkey.as_str(), move |app, _shortcut, event| {
                match event.state() {
                    ShortcutState::Pressed => on_press(app),
                    ShortcutState::Released => on_release(app),
                }
            })?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::list_microphones,
            commands::list_models,
            commands::download_model,
            commands::get_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Ensure main.rs delegates to lib.rs**

Replace `src-tauri/src/main.rs` with:

```rust
// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    openwispr_lib::run();
}
```

- [ ] **Step 6: Grant frontend permission to call the global-shortcut plugin and our commands**

In `src-tauri/capabilities/default.json`, ensure the `permissions` array includes the global-shortcut and core permissions. Add these entries if missing:

```json
"global-shortcut:allow-register",
"global-shortcut:allow-unregister",
"global-shortcut:allow-is-registered",
"core:window:allow-show",
"core:window:allow-hide",
"core:window:allow-set-focus"
```

- [ ] **Step 7: Make run() the entry and confirm the project compiles**

Run: `cd ~/Github/openwispr/src-tauri && cargo build`
Expected: compiles with no errors. (`cargo test` should still pass all prior unit tests.)

- [ ] **Step 8: Download the model through the UI**

Run: `cd ~/Github/openwispr && pnpm tauri dev`
In the settings window: confirm the microphone dropdown lists your mics and the model list shows `base.en`. Click **Download** and watch the percentage climb to 100%, then the button shows **Ready**. Set Language to `en`, click **Save settings** (shows "Saved ✓").

- [ ] **Step 9: End-to-end smoke test of dictation**

With the app still running, open a plain text editor (TextEdit/Notepad/gedit) and click into it. Hold **Alt+Space**, say "testing one two three", and release.
Expected: the overlay pill appears with a pulsing red dot and a moving level meter while held; on release it shows "Transcribing…" then disappears, and the transcribed text appears in the editor.

On macOS the first run will prompt for **Microphone** and **Accessibility** permissions — grant both (System Settings → Privacy & Security), then restart the app and retry.

- [ ] **Step 10: Run the ignored STT integration test to confirm the model path still works**

Run: `cd ~/Github/openwispr/src-tauri && cargo test --test stt_integration -- --ignored`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
cd ~/Github/openwispr
git add -A
git commit -m "feat: wire windows, tray, push-to-talk hotkey, and end-to-end orchestration"
```

---

## Task 14: Format, lint, and final verification

**Files:** none (verification only)

- [ ] **Step 1: Format Rust and check lints**

```bash
cd ~/Github/openwispr/src-tauri
cargo fmt
cargo clippy --all-targets -- -D warnings
```

Expected: `cargo fmt` rewrites nothing on a second run; `cargo clippy` exits cleanly. Fix any warnings it reports.

- [ ] **Step 2: Run the full Rust test suite**

Run: `cd ~/Github/openwispr/src-tauri && cargo test`
Expected: all unit tests PASS; the STT integration test shows as `ignored`.

- [ ] **Step 3: Typecheck and build the frontend**

```bash
cd ~/Github/openwispr
pnpm build
```

Expected: TypeScript compiles and Vite builds with no errors.

- [ ] **Step 4: Commit any formatting changes**

```bash
cd ~/Github/openwispr
git add -A
git commit -m "chore: cargo fmt and clippy clean-up"
```

---

## Done

At this point OpenWispr is a working MVP: hold the hotkey, speak, release, and locally-transcribed text is inserted into the focused app, with a tray icon, a settings window (hotkey, mic, language, model download, inject method), and an animated recording overlay — all matching the approved spec.

**Deferred to future plans (out of MVP scope, per spec):** AI text cleanup/LLM formatting, toggle/hands-free mode, VAD, custom vocabulary, voice commands, cloud STT/LLM, automatic language detection, and packaging/signing/CI.
