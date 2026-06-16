<p align="center">
  <img src="assets/logo.png" alt="OpenWispr" width="168">
</p>

<h1 align="center">OpenWispr</h1>

<p align="center">
  <strong>Open-source, local-first voice dictation.</strong><br>
  Hold a hotkey, speak, release — your words are transcribed on-device with
  Whisper and typed into whatever app you're using.
</p>

<p align="center">
  <a href="https://github.com/hudsonbrendon/openwispr/releases/latest">Download</a> ·
  <a href="#build-from-source">Build from source</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="#license">License</a>
</p>

<p align="center">
  <a href="https://github.com/hudsonbrendon/openwispr/actions/workflows/ci.yml"><img src="https://github.com/hudsonbrendon/openwispr/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/hudsonbrendon/openwispr"><img src="https://codecov.io/gh/hudsonbrendon/openwispr/branch/main/graph/badge.svg" alt="Coverage"></a>
  <a href="https://github.com/hudsonbrendon/openwispr/releases/latest"><img src="https://img.shields.io/github/v/release/hudsonbrendon/openwispr?sort=semver" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/hudsonbrendon/openwispr" alt="License"></a>
  <img src="https://img.shields.io/badge/built%20with-Tauri-24C8DB?logo=tauri&logoColor=white" alt="Built with Tauri">
</p>

---

## What it is

OpenWispr is a free, open alternative to Wispr Flow. Everything runs on your
machine — **no cloud, no account, no telemetry**. Audio never leaves your
computer; transcription happens locally via [whisper.cpp](https://github.com/ggerganov/whisper.cpp).

It lives in your system tray and stays out of the way until you need it.

## Features

- 🎙️ **Push-to-talk dictation** — hold a global hotkey, speak, release, and the
  text is inserted into the focused app.
- 🔒 **100% local** — on-device Whisper inference; nothing is sent anywhere.
- 🌍 **Multilingual** — transcribe in 99 languages, or let Whisper auto-detect.
- 📦 **Model manager** — download, switch, and remove Whisper models from inside
  the app, with live download progress and cancel.
- ⌨️ **Custom hotkey** — click to capture any key combo.
- 🖱️ **Two injection modes** — synthetic keystrokes or clipboard paste.
- 🪟 **Lives in the tray** — closing the window keeps it running in the
  background; quit from the tray menu.

## Install

Grab the installer for your platform from the
[latest release](https://github.com/hudsonbrendon/openwispr/releases/latest):

| Platform                          | Asset                |
| --------------------------------- | -------------------- |
| **macOS** (Apple Silicon / Intel) | `.dmg`               |
| **Windows**                       | `.msi` / `.exe`      |
| **Linux**                         | `.AppImage` / `.deb` |

> macOS builds are unsigned for now — on first launch, right-click the app and
> choose **Open**, or allow it under **System Settings → Privacy & Security**.

## Usage

1. Open **Settings** from the tray icon.
2. Download a model (start with **base** for a good size/quality balance; use
   **small** or **large-v3-turbo** for higher accuracy in non-English).
3. Pick your language (or **Detect automatically**) and set your hotkey.
4. Anywhere you can type, **hold the hotkey, speak, release** — your words appear.

### Choosing a model

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

## Build from source

**Prerequisites:** [Rust](https://rustup.rs), [Node.js](https://nodejs.org),
[pnpm](https://pnpm.io), and the
[Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```bash
pnpm install
pnpm tauri dev      # run in development
pnpm tauri build    # produce a release bundle for your platform
```

### Test

```bash
cd src-tauri && cargo test
```

## Tech stack

- **[Tauri 2](https://tauri.app)** — native shell, tray, global shortcuts
- **React + TypeScript + Vite** — settings UI
- **Rust** — audio capture, Whisper inference, text injection
- **[whisper.cpp](https://github.com/ggerganov/whisper.cpp)** — on-device speech-to-text

## Releases

Pushing a `v*` tag triggers the [release workflow](.github/workflows/release.yml),
which builds and publishes installers for macOS, Linux, and Windows as a draft
GitHub Release.

```bash
git tag v0.1.0
git push origin v0.1.0
```

## License

[MIT](LICENSE)
