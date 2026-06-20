<p align="center">
  <img src="assets/logo.png" alt="Wisper" width="180">
</p>

<h1 align="center">Wisper</h1>

<p align="center">
  <strong>Open-source, local-first voice dictation for your desktop.</strong><br>
  Hold a hotkey, speak, release — your words are transcribed <em>on-device</em>
  with Whisper and typed straight into whatever app you're using.
</p>

<p align="center">
  <strong><a href="https://wisper.chat/">🌐 Website &amp; downloads</a></strong>
</p>

<p align="center">
  <a href="https://github.com/99labdev/wisper.chat/releases/latest">Download</a> ·
  <a href="#-quick-start">Quick start</a> ·
  <a href="#-build-from-source">Build from source</a> ·
  <a href="#-troubleshooting">Troubleshooting</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="#-license">License</a>
</p>

<p align="center">
  <a href="https://github.com/99labdev/wisper.chat/actions/workflows/ci.yml"><img src="https://github.com/99labdev/wisper.chat/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/99labdev/wisper.chat"><img src="https://codecov.io/gh/99labdev/wisper.chat/branch/main/graph/badge.svg" alt="Coverage"></a>
  <a href="https://github.com/99labdev/wisper.chat/releases/latest"><img src="https://img.shields.io/github/v/release/99labdev/wisper.chat?sort=semver" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/99labdev/wisper.chat" alt="License"></a>
  <img src="https://img.shields.io/badge/built%20with-Tauri-24C8DB?logo=tauri&logoColor=white" alt="Built with Tauri">
  <img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platforms">
  <a href="https://github.com/99labdev/wisper.chat/commits/main"><img src="https://img.shields.io/github/last-commit/99labdev/wisper.chat" alt="Last commit"></a>
  <a href="https://github.com/99labdev/wisper.chat/issues"><img src="https://img.shields.io/github/issues/99labdev/wisper.chat" alt="Open issues"></a>
  <a href="https://github.com/99labdev/wisper.chat/stargazers"><img src="https://img.shields.io/github/stars/99labdev/wisper.chat?style=flat" alt="Stars"></a>
</p>

---

## Contents

- [What it is](#what-it-is)
- [Why Wisper](#why-wisper)
- [Features](#-features)
- [Quick start](#-quick-start)
- [Install](#-install)
- [Permissions](#-permissions)
- [Usage](#-usage)
- [Configuration](#-configuration)
- [Models](#-models)
- [Languages](#-languages)
- [How it works](#-how-it-works)
- [Privacy](#-privacy)
- [Build from source](#-build-from-source)
- [Project layout](#-project-layout)
- [Tech stack](#-tech-stack)
- [Updates &amp; releases](#-updates--releases)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [License](#-license)
- [Acknowledgements](#-acknowledgements)

## What it is

Wisper is a free, open alternative to cloud dictation tools like Wispr Flow.
Everything runs on your machine — **no cloud, no account, no telemetry, no
subscription**. Your audio never leaves your computer; transcription happens
entirely on-device via [whisper.cpp](https://github.com/ggerganov/whisper.cpp),
with Metal GPU acceleration on Apple Silicon.

It lives in your system tray as a small floating "pill" and stays out of the way
until you press your hotkey.

## Why Wisper

|                      | Wisper                       | Typical cloud dictation |
| -------------------- | ---------------------------- | ----------------------- |
| **Where audio goes** | Stays on your device         | Uploaded to a server    |
| **Account required** | No                           | Usually yes             |
| **Cost**             | Free &amp; open source (MIT) | Subscription            |
| **Works offline**    | Yes                          | No                      |
| **Telemetry**        | None                         | Common                  |
| **Languages**        | 99 (Whisper)                 | Varies                  |
| **Customizable**     | Source is yours              | Closed                  |

## ✨ Features

- 🎙️ **Push-to-talk & hands-free** — hold the hotkey to dictate while held, or
  **double-tap** to keep recording without holding; a later single press stops
  and inserts.
- ⌨️ **Any hotkey you want** — bind a combo (`Ctrl+Shift+Z`) **or a single
  modifier on its own** (just `Option`, `Ctrl`, or `Shift`, push-to-talk style).
- 🔒 **100% local** — on-device Whisper inference; nothing is ever sent anywhere.
- ⚡ **GPU-accelerated** — Metal on Apple Silicon for near-instant transcription.
- 🌍 **99 transcription languages** — pick one or let Whisper auto-detect.
- 🗣️ **Localized interface** — UI, tray menu, and error messages in **15
  languages** (English, Português, Español, Français, Deutsch, Italiano,
  Nederlands, Русский, Polski, Türkçe, 日本語, 한국어, 中文, العربية, हिन्दी).
- 📦 **Built-in model manager** — download, switch, and remove Whisper models
  from inside the app, with live progress and cancel.
- 📖 **Custom dictionary** — teach it names and jargon so they're spelled right.
- 🔁 **Text replacements** — auto-rewrite snippets in every transcript
  (e.g. `omw` → `on my way`).
- 📊 **Insights & history** — a local, honest log of what you dictated with
  words-per-minute and daily stats. Nothing fabricated, nothing uploaded.
- 🖱️ **Two injection modes** — synthetic keystrokes or clipboard paste.
- 🔊 **Dictation sounds & music ducking** — optional start/stop cues; optionally
  mute playing music while you talk.
- 🪟 **Tray-native** — closing the window keeps it running; quit from the tray.
- 🚀 **Launch at login** and optional **menu-bar-only** (hide the Dock icon).
- 🌗 **Light & dark theme.**
- 🔄 **Automatic updates** — signed over-the-air updates via GitHub Releases.

## 🚀 Quick start

1. [Download](https://github.com/99labdev/wisper.chat/releases/latest) and
   install for your OS.
2. Launch it and complete the short onboarding.
3. Grant **Microphone** (and on macOS, **Accessibility**) permission — see
   [Permissions](#-permissions).
4. Download a model (start with **base**) and pick your language.
5. Anywhere you can type, **hold your hotkey, speak, release** — your words
   appear in the focused app.

## 📥 Install

Grab the installer for your platform from the
[latest release](https://github.com/99labdev/wisper.chat/releases/latest):

| Platform                          | Asset                |
| --------------------------------- | -------------------- |
| **macOS** (Apple Silicon / Intel) | `.dmg`               |
| **Windows**                       | `.msi` / `.exe`      |
| **Linux**                         | `.AppImage` / `.deb` |

> [!NOTE]
> macOS builds are ad-hoc signed (no paid Developer ID yet). On first launch,
> **right-click the app → Open**, or allow it under **System Settings → Privacy &
> Security**. After that it opens normally and updates itself.

## 🔐 Permissions

Wisper needs OS-level permissions to hear you and to type for you:

| Permission                | Why                                                    | Where                                                    |
| ------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| **Microphone**            | Capture your voice                                     | macOS/Win/Linux prompt on first record                   |
| **Accessibility** (macOS) | Insert text into other apps and read the global hotkey | System Settings → Privacy & Security → **Accessibility** |

On macOS, after an app **update** the system can occasionally drop the
Accessibility grant. Wisper detects this and re-prompts; if text stops
inserting after an update, re-enable it under Accessibility (see
[Troubleshooting](#-troubleshooting)).

## 🧭 Usage

1. Open **Settings** from the tray icon.
2. **Download a model** — start with **base** for a good size/quality balance;
   use **small** or **large-v3-turbo** for higher accuracy, especially in
   non-English.
3. Choose your **language** (or **Detect automatically**) and set your **hotkey**
   (a combo or a single modifier).
4. Dictate:
   - **Push-to-talk** — hold the hotkey, speak, release.
   - **Hands-free** — double-tap the hotkey to start, single-press to stop.
5. The floating pill shows recording state and a quick language switcher. Closing
   the main window keeps Wisper running in the tray.

## ⚙️ Configuration

Everything is in **Settings**, persisted to a local `config.toml`:

| Setting                | What it does                                                              |
| ---------------------- | ------------------------------------------------------------------------- |
| **Hotkey**             | Click to capture any combo, or a lone modifier (`Option`/`Ctrl`/`Shift`). |
| **Model**              | Active Whisper model; manage downloads here.                              |
| **Language**           | Transcription language, or auto-detect.                                   |
| **Interface language** | UI, tray, and error-message language (15 options).                        |
| **Microphone**         | Input device, or system default.                                          |
| **Injection mode**     | `type` (synthetic keystrokes) or `paste` (clipboard).                     |
| **Dictionary**         | Bias words so names/jargon transcribe correctly.                          |
| **Replacements**       | `from → to` rewrites applied to every transcript.                         |
| **Dictation sounds**   | Start/stop audio cues.                                                    |
| **Mute music**         | Duck other audio while recording.                                         |
| **Show pill**          | Keep the floating pill on screen, or hide until dictating.                |
| **Show in Dock**       | Toggle Dock icon vs. menu-bar-only (macOS).                               |
| **Launch at login**    | Start Wisper automatically.                                               |
| **Theme**              | Light or dark.                                                            |

## 🧠 Models

Whisper's multilingual models transcribe all languages from a single file; the
`.en` variants are English-only but a little faster. Bigger = more accurate and
slower.

| Model                  | Size    | Languages                       |
| ---------------------- | ------- | ------------------------------- |
| `tiny` / `tiny.en`     | ~75 MB  | all / English                   |
| `base` / `base.en`     | ~142 MB | all / English                   |
| `small` / `small.en`   | ~466 MB | all / English                   |
| `medium` / `medium.en` | ~1.5 GB | all / English                   |
| `large-v3-turbo`       | ~1.6 GB | all (near-large accuracy, fast) |

Models are downloaded on demand from inside the app and stored locally; you can
remove them anytime to reclaim space.

## 🌍 Languages

- **Transcription:** 99 languages supported by Whisper, plus automatic detection.
- **Interface:** English, Português, Español, Français, Deutsch, Italiano,
  Nederlands, Русский, Polski, Türkçe, 日本語, 한국어, 中文, العربية, हिन्दी —
  applied to the window UI, the tray menu, and error toasts.

## 🔧 How it works

```
   ┌──────────┐   hold/double-tap   ┌─────────────┐   PCM audio   ┌──────────────┐
   │  Hotkey  │ ──────────────────▶ │   Recorder  │ ───────────▶ │ whisper.cpp  │
   │ (global) │                     │   (cpal)    │              │  (on-device) │
   └──────────┘                     └─────────────┘              └──────┬───────┘
                                                                        │ text
                                          ┌──────────────┐   keystrokes │
   focused app  ◀───────────────────────  │  Injector    │ ◀────────────┘
                                          │ (type/paste) │
                                          └──────────────┘
```

A global shortcut (or single-modifier event tap) starts capture, audio is
recorded with `cpal`, transcribed locally by `whisper.cpp`, run through your
dictionary/replacements, and injected into the focused app as keystrokes or a
clipboard paste. The floating pill is a non-activating overlay so it never steals
focus from the app you're typing into.

## 🛡️ Privacy

- Audio is processed **entirely on your device** and is **not stored** after
  transcription.
- **No account, no telemetry, no network calls** for transcription.
- The only network activity is **downloading models** you ask for and
  **checking for app updates** from GitHub Releases.
- History and insights are kept **locally** and never leave your machine.

## 🏗️ Build from source

**Prerequisites:** [Rust](https://rustup.rs), [Node.js](https://nodejs.org),
[pnpm](https://pnpm.io), and the
[Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```bash
git clone https://github.com/99labdev/wisper.chat.git
cd wisper.chat
pnpm install
pnpm tauri dev      # run in development
pnpm tauri build    # produce a release bundle for your platform
```

### Checks

```bash
# Frontend
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit
pnpm test           # Vitest
pnpm format:check   # Prettier

# Backend (Rust)
cd src-tauri
cargo test
cargo clippy -- -D warnings
cargo fmt --check
```

## 📁 Project layout

```
wisper/
├── src/                 # React + TypeScript settings UI
│   ├── routes/          # Home, Settings, Insights, Dictionary, Snippets, Overlay…
│   └── lib/             # api bindings, i18n, theme, hotkey helpers
├── src-tauri/           # Rust backend
│   └── src/
│       ├── audio.rs     # microphone capture (cpal)
│       ├── stt.rs       # Whisper transcription (whisper.cpp)
│       ├── inject.rs    # text injection (keystrokes / paste)
│       ├── modtap.rs    # single-modifier hotkey (macOS event tap)
│       ├── uitext.rs    # localized tray + error strings
│       ├── overlay.rs   # pill geometry & hit-testing
│       └── lib.rs       # app wiring, tray, shortcuts, windows
├── site/                # marketing website (GitHub Pages)
└── .github/workflows/   # CI + cross-platform release
```

## 🧩 Tech stack

- **[Tauri 2](https://tauri.app)** — native shell, tray, global shortcuts, OTA updater
- **React + TypeScript + Vite** — settings UI
- **Rust** — audio capture, Whisper inference, text injection, hotkey handling
- **[whisper.cpp](https://github.com/ggerganov/whisper.cpp)** (via `whisper-rs`) — on-device speech-to-text, Metal-accelerated on macOS
- **[cpal](https://github.com/RustAudio/cpal)** — cross-platform audio capture

## 🔄 Updates & releases

Wisper updates itself: it checks GitHub Releases and applies signed
over-the-air updates in the background.

For maintainers, pushing a `v*` tag triggers the
[release workflow](.github/workflows/release.yml), which builds and publishes
installers for macOS, Linux, and Windows plus the updater manifest:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## 🩺 Troubleshooting

<details>
<summary><strong>It records but no text is inserted</strong></summary>

Grant **Accessibility** permission (macOS: System Settings → Privacy & Security →
Accessibility) so Wisper can type into other apps. After a macOS update the
grant can reset — toggle Wisper off and on in that list. As a fallback, switch
the **injection mode** to **paste** in Settings.

</details>

<details>
<summary><strong>The microphone isn't capturing audio</strong></summary>

Allow **Microphone** access when prompted (or in your OS privacy settings), and
make sure the right input device is selected in **Settings → Microphone**. On
macOS, a permission can need re-granting right after installing or updating.

</details>

<details>
<summary><strong>Transcription is slow</strong></summary>

Use a smaller model (**base** or **small**), or **large-v3-turbo** for a good
speed/accuracy trade-off. On Apple Silicon, Metal acceleration is enabled
automatically.

</details>

<details>
<summary><strong>macOS won't open the app ("unidentified developer")</strong></summary>

Right-click the app → **Open**, then confirm. Builds are ad-hoc signed; this is a
one-time step.

</details>

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md), keep
changes focused, and run the checks above before opening a PR. Bug reports and
feature ideas are great as [issues](https://github.com/99labdev/wisper.chat/issues).

## 📄 License

[MIT](LICENSE) © Hudson Brendon

## 🙏 Acknowledgements

- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) and OpenAI's Whisper for on-device speech recognition
- [Tauri](https://tauri.app) for the native cross-platform shell
- Everyone who tests Wisper and files issues
  </content>
