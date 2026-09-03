#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${STAMP_RELEASE_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

if [ "${1:-}" = "" ]; then
  echo "Usage: scripts/stamp-release-version.sh <version>" >&2
  exit 1
fi

cd "$ROOT"
export STAMP_RELEASE_ROOT="$ROOT"
exec bun "$SCRIPT_DIR/sync-desktop-version.ts" --release "$1"
