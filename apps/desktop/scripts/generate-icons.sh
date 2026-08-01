#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bun run tauri icon app-icon.svg -o src-tauri/icons

# Tauri emits iOS/Android/Store assets we do not bundle; keep macOS/Windows set only.
rm -rf src-tauri/icons/android src-tauri/icons/ios
rm -f src-tauri/icons/Square*.png src-tauri/icons/StoreLogo.png src-tauri/icons/64x64.png src-tauri/icons/icon.png
