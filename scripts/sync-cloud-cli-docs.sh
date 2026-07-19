#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-${HARNESSTAP_CLOUD_DOCS_PATH:-}}"

if [[ -z "$TARGET" ]]; then
  echo "Usage: HARNESSTAP_CLOUD_DOCS_PATH=<path> $0" >&2
  echo "   or: $0 <target-command-reference.md>" >&2
  exit 1
fi

SOURCE="$ROOT/docs/cli/command-reference.md"
if [[ ! -f "$SOURCE" ]]; then
  echo "Missing source: $SOURCE" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET")"
cp "$SOURCE" "$TARGET"
echo "Synced $SOURCE -> $TARGET"
