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
