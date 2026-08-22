#!/usr/bin/env bash
set -euo pipefail

# Run Tauri desktop + sidecar watcher together so agent/src changes rebuild and
# restart ht-agent without killing `tauri dev`.

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

bun run desktop:cleanup
bun run desktop:prepare-sidecar

cd "$ROOT/apps/desktop"
bun install

TAURI_PID=""
WATCH_PID=""

cleanup() {
  if [[ -n "$WATCH_PID" ]] && kill -0 "$WATCH_PID" 2>/dev/null; then
    kill "$WATCH_PID" 2>/dev/null || true
  fi
  if [[ -n "$TAURI_PID" ]] && kill -0 "$TAURI_PID" 2>/dev/null; then
    kill "$TAURI_PID" 2>/dev/null || true
    wait "$TAURI_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

bun "$ROOT/apps/desktop/scripts/watch-sidecar.ts" &
WATCH_PID=$!

bun run tauri dev &
TAURI_PID=$!

STARTED_AT=$(date +%s)
wait "$TAURI_PID"
ELAPSED_S=$(( $(date +%s) - STARTED_AT ))
if (( ELAPSED_S < 15 )); then
  echo "" >&2
  echo "desktop-dev: tauri dev exited after ${ELAPSED_S}s. If no window appeared," >&2
  echo "another HarnessTap instance (stale dev app or installed build) likely holds" >&2
  echo "the single-instance lock; close it and rerun bun run desktop:dev." >&2
fi
