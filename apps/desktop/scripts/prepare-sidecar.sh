#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TARGET="$(rustc -vV | sed -n 's/^host: //p')"
DEST_DIR="$ROOT/apps/desktop/src-tauri/binaries"
PREPARED="$DEST_DIR/ht-agent-$TARGET"

cd "$ROOT"
bun run build:sidecar
mkdir -p "$DEST_DIR"
cp "$ROOT/dist/sidecar/ht-agent" "$PREPARED"

echo "Prepared sidecar binary: $PREPARED"

# Refresh copies that `tauri dev` already placed next to the debug/release
# executable so the next sidecar restart picks up the new agent without a full
# Tauri relaunch.
refresh_if_present() {
  local dest="$1"
  local dir
  dir="$(dirname "$dest")"
  if [[ -d "$dir" ]]; then
    cp "$PREPARED" "$dest"
    chmod +x "$dest"
    echo "Updated $dest"
  fi
}

if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then
  refresh_if_present "$CARGO_TARGET_DIR/debug/ht-agent"
  refresh_if_present "$CARGO_TARGET_DIR/release/ht-agent"
fi

refresh_if_present "$ROOT/apps/desktop/src-tauri/target/debug/ht-agent"
refresh_if_present "$ROOT/apps/desktop/src-tauri/target/release/ht-agent"
