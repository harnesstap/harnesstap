#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
bun run desktop:prepare-sidecar
cd "$ROOT/apps/desktop"
bun install
# WebdriverIO launches src-tauri/target/debug/harnesstap-desktop. Skip installers
# (Linux AppImage uses linuxdeploy and is not needed for desktop:e2e).
# --no-bundle is a Tauri CLI flag: skip bundling even if bundle.active is true.
# --bundles none is invalid in Tauri 2 and must not be used.
VITE_E2E=1 bun run tauri build --debug --no-bundle -- --features e2e
