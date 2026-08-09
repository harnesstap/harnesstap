#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
bun run desktop:prepare-sidecar
cd "$ROOT/apps/desktop"
bun install
VITE_E2E=1 bun run tauri build --debug -- --features e2e
