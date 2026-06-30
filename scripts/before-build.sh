#!/usr/bin/env bash
set -euo pipefail
# Build the summary sidecar and stage it for Tauri's externalBin (which expects
# binaries/<name>-<target-triple>). Then run the frontend build.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Which triple to build the sidecar for. CI sets WISPER_BUILD_TARGET per matrix
# leg so the Intel build on an arm64 runner cross-builds for x86_64 (otherwise
# Tauri's externalBin lookup fails: "resource path
# binaries/wisper-summarize-x86_64-apple-darwin doesn't exist"). When unset
# (local `pnpm tauri build`), fall back to the host triple — no cross-compile.
TARGET="${WISPER_BUILD_TARGET:-}"
if [ -z "$TARGET" ]; then
  TARGET="$(rustc -Vv | sed -n 's/^host: //p')"
  ( cd src-tauri && cargo build --release -p wisper-summarize )
  SRC="src-tauri/target/release/wisper-summarize"
else
  ( cd src-tauri && cargo build --release -p wisper-summarize --target "$TARGET" )
  SRC="src-tauri/target/${TARGET}/release/wisper-summarize"
fi

mkdir -p src-tauri/binaries
cp "$SRC" "src-tauri/binaries/wisper-summarize-${TARGET}"
pnpm build
