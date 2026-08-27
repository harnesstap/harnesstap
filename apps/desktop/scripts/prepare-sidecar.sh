#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TARGET="$(rustc -vV | sed -n 's/^host: //p')"
DEST_DIR="$ROOT/apps/desktop/src-tauri/binaries"
# Windows sidecars must use the .exe suffix (Tauri externalBin convention).
EXE_SUFFIX=""
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) EXE_SUFFIX=".exe" ;;
esac
PREPARED="$DEST_DIR/ht-agent-$TARGET$EXE_SUFFIX"
SIDECAR_SRC="$ROOT/dist/sidecar/ht-agent$EXE_SUFFIX"

cd "$ROOT"
bun run build:sidecar
mkdir -p "$DEST_DIR"
cp "$SIDECAR_SRC" "$PREPARED"

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
  refresh_if_present "$CARGO_TARGET_DIR/debug/ht-agent$EXE_SUFFIX"
  refresh_if_present "$CARGO_TARGET_DIR/release/ht-agent$EXE_SUFFIX"
fi

refresh_if_present "$ROOT/apps/desktop/src-tauri/target/debug/ht-agent$EXE_SUFFIX"
refresh_if_present "$ROOT/apps/desktop/src-tauri/target/release/ht-agent$EXE_SUFFIX"

# Signal the running Tauri shell to restart the sidecar (see lib.rs watcher).
STAMP="$DEST_DIR/.sidecar-reload"
date +%s >"$STAMP"
echo "Wrote reload stamp: $STAMP"
