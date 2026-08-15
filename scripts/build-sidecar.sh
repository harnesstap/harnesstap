#!/usr/bin/env bash
set -euo pipefail

# Compile the desktop agent sidecar. bun build --compile writes a
# `.{hex}-00000000.bun-build` scratch Mach-O into cwd, then renames it to
# --outfile. Interrupted compiles (sidecar watch, Ctrl+C) leave those ~60MB
# copies in the repo root. Run from a temp dir so leftovers never land here.
# See https://github.com/oven-sh/bun/issues/14020

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENTRY="$ROOT/src/agent/entry.ts"
OUT="$ROOT/dist/sidecar/ht-agent"

mkdir -p "$(dirname "$OUT")"

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/harnesstap-sidecar-XXXX")"
cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

cd "$WORKDIR"
bun build --compile "$ENTRY" --outfile "$OUT"
