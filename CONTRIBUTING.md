# Contributing to OpenWispr

Thanks for your interest in improving OpenWispr! This guide covers how to get a
dev environment running and the checks your change needs to pass.

## Prerequisites

- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) (LTS) and [pnpm](https://pnpm.io)
- The [Tauri system dependencies](https://tauri.app/start/prerequisites/) for
  your OS (on Linux: `libwebkit2gtk-4.1-dev`, `libasound2-dev`, `libxdo-dev`,
  `librsvg2-dev`, `patchelf`, `libappindicator3-dev`).

## Getting started

```bash
git clone https://github.com/99labdev/wisper.chat
cd wisper.chat
pnpm install
pnpm tauri dev      # run the app with hot reload
```

## Project layout

- `src/` — React + TypeScript frontend (the dashboard and the floating pill).
- `src-tauri/src/` — Rust backend. Pure, testable modules: `state` (dictation
  state machine), `config`, `history`, `audio` (sample math), `hotkey` (gesture
  controller), `overlay` (geometry). The I/O glue lives in `lib.rs`,
  `commands.rs`, `inject.rs`, and `audio.rs`'s device code.
- `docs/superpowers/` — design specs and implementation plans.

## Checks (run before opening a PR)

The CI runs all of these; run them locally first.

**Frontend**

```bash
pnpm format:check   # Prettier
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit
pnpm coverage       # Vitest + coverage
```

Auto-fix formatting with `pnpm format`.

**Rust** (from `src-tauri/`)

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

> `cargo` commands compile `tauri::generate_context!`, which embeds the built
> frontend — run `pnpm build` once first if you hit a missing `dist` error.

## Tests

- Rust: unit tests live inline in each module under `#[cfg(test)]`. Add tests for
  any new pure logic.
- Frontend: Vitest specs live next to the code as `*.test.ts(x)`.

We aim to keep coverage high — new logic should come with tests.

## Commit & PR

- Keep commits focused; use clear messages (Conventional Commits style is
  welcome, e.g. `feat:`, `fix:`, `docs:`).
- Open a PR against `main`. CI must be green (lint, types, tests, coverage).
- Describe what changed and why; screenshots help for UI changes.

## License

By contributing, you agree that your contributions are licensed under the
project's [LICENSE](LICENSE).
