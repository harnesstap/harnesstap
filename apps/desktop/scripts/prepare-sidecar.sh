#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TARGET="$(rustc -vV | sed -n 's/^host: //p')"
DEST_DIR="$ROOT/apps/desktop/src-tauri/binaries"

cd "$ROOT"
bun run build:sidecar
mkdir -p "$DEST_DIR"
cp "$ROOT/dist/sidecar/ht-agent" "$DEST_DIR/ht-agent-$TARGET"

echo "Prepared sidecar binary: $DEST_DIR/ht-agent-$TARGET"
