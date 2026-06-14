# OpenWispr — Design

**Status:** Approved design (brainstorming output)
**Date:** 2026-06-14
**License:** MIT

## What it is

OpenWispr is an open-source, mostly-local voice dictation app — an open
alternative to Wispr Flow. The user holds a global hotkey, speaks, and on
release the speech is transcribed locally with Whisper and the resulting text
is injected into whatever application is focused (text fields, editors,
terminals, browsers). No cloud, no account.

## Goals

- **Local-first / private:** transcription runs on-device via whisper.cpp. No
  audio leaves the machine.
- **Cross-platform:** macOS, Windows, and Linux from the first release, one
  codebase.
- **Beautiful + native-feeling:** lightweight Tauri shell — native windows
  (transparency, always-on-top, OS vibrancy/blur), tray icon, and a polished
  web UI for settings and the recording overlay.
- **Zero-friction dictation:** hold key → speak → release → text appears in the
  active app.

## Non-goals (MVP boundary, YAGNI)

Explicitly out of the MVP, deferred to future work:

- AI text cleanup / LLM formatting (Whisper's own punctuation is enough for v1)
- Toggle / hands-free activation mode (push-to-talk only)
- Voice Activity Detection (VAD)
- Custom vocabulary / dictionary
- Voice commands ("new line", "delete that")
- Any cloud STT or cloud LLM
- Automatic language detection (a single configured language for v1)

## Decisions

| Decision | Choice |
|---|---|
| Target platforms | macOS, Windows, Linux (cross-platform from day 1) |
| App shell | Tauri (Rust core + web frontend) |
| STT engine | whisper.cpp, local only, via `whisper-rs` |
| Text cleanup | None in MVP (raw Whisper output) |
| Activation | Push-to-talk (hold hotkey) |
| UI surface | Tray icon + settings window + recording overlay |
| License | MIT |
| Repo | `~/Github/openwispr`, branch `main` |

## Architecture

### Process model

A single Tauri application. **All heavy lifting lives in the Rust core; the
webview is UI only.** Two windows:

- **Settings window** — a normal window, opened from the tray menu.
- **Overlay window** — frameless, transparent, always-on-top; shows recording
  state and live mic level; fades out after the text is injected.

### Rust core modules

Each module has a single responsibility and a well-defined interface so it can
be understood and tested in isolation.

1. **`hotkey`** — wraps the `global-hotkey` crate. Registers the configured
   push-to-talk key, emits `Pressed` / `Released` events to the state machine.
2. **`audio`** — wraps `cpal`. On demand, opens an input stream on the
   configured device and captures mono audio resampled to 16 kHz `f32` into a
   buffer while recording is active; stops and returns the buffer on demand.
3. **`stt`** — wraps `whisper-rs`. Loads a ggml model once at startup (or after
   download) and transcribes an audio buffer into a `String`. Configured
   language is passed through.
4. **`inject`** — types text into the focused app. Primary path: `enigo`
   keyboard typing. Fallback path: copy to clipboard (`arboard`) then send the
   paste shortcut (Cmd+V / Ctrl+V). The active method is configurable
   (`Type` | `Paste`); `Paste` is the default fallback for Wayland where
   synthetic typing is restricted.
5. **`config`** — `serde` + TOML, stored in the OS config directory. Fields:
   hotkey, model id, mic device, language, inject method. Provides load (with
   defaults) and atomic save.
6. **`model_manager`** — on first run, downloads the selected Whisper ggml model
   from the Hugging Face `ggerganov/whisper.cpp` repo into the OS app-data
   directory, verifies it against a known SHA-256, and reports progress. Skips
   download if a verified file already exists.
7. **`state`** — the orchestrator. A pure state machine:
   `Idle → Recording → Transcribing → Injecting → Idle`. Holds no I/O itself;
   transitions are driven by events (hotkey, transcription done) and it calls
   into the other modules. Emits state-change events to the frontend. Being
   pure makes it unit-testable without hardware.
8. **`tray`** — wraps `tray-icon`. Menu items: Settings, Quit. The tray icon
   reflects the current state (idle vs recording).

### Frontend (web, in the Tauri webview)

- **Settings UI:** hotkey capture control, model picker with download progress,
  microphone dropdown (populated from the core), language select, inject-method
  toggle.
- **Overlay UI:** a small animated pill showing the current state and a live mic
  level meter; fades in on record start, out after injection.

Styling: Tailwind + shadcn-style components for a clean, modern look.

### Data flow

```
hotkey down
  → state: Idle → Recording
  → audio: open stream, buffer samples
  → overlay: show, animate mic level
hotkey up
  → audio: stop stream, return buffer
  → state: Recording → Transcribing
  → stt: transcribe buffer → text
  → state: Transcribing → Injecting
  → inject: type/paste text into focused app
  → overlay: fade out
  → state: Injecting → Idle
```

### IPC (Tauri)

- **Commands (frontend → core):** save config, list microphones, start model
  download, get current config/state.
- **Events (core → frontend):** state change, live audio level, transcript
  result, model download progress, errors.

## Error handling

- Rust `Result` everywhere, error types via `thiserror`; logging via `tracing`.
- **No microphone / device error:** surface an error toast in the UI, return to
  Idle.
- **Model missing:** prompt the user to download it (the model picker drives
  `model_manager`).
- **Injection failure:** fall back from `Type` to clipboard `Paste`; if that
  also fails, notify the user.
- **OS permissions (macOS):** detect missing Accessibility (for injection) and
  Microphone permissions, and explain to the user how to grant them.

## Testing strategy

- **Unit-tested (pure logic, no hardware):**
  - `config` — TOML round-trip and default fallback.
  - `state` — every transition of the state machine.
  - `model_manager` — SHA-256 verification against a small fixture.
- **I/O modules (`audio`, `stt`, `inject`):** exercised by manual smoke tests.
  A transcription test against a fixed `.wav` fixture exists but is marked
  `#[ignore]` (slow and mildly non-deterministic), runnable on demand.
- The state machine is deliberately pure so the end-to-end orchestration logic
  is testable without a mic, model, or display.

## Cross-platform notes

- **Injection:** `enigo` covers macOS (requires Accessibility permission),
  Windows (`SendInput`), and Linux/X11. Wayland restricts synthetic typing, so
  the clipboard-paste fallback is the default there.
- **Permissions:** macOS prompts for Microphone and Accessibility; the app
  detects and guides the user. Windows and X11 need no special grants for the
  core flow.

## Distribution

- New git repository at `~/Github/openwispr`, MIT licensed.
- Tauri produces a signed native bundle per OS. Packaging/signing/CI are beyond
  the MVP code scope and tracked separately.
