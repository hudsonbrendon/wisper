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
