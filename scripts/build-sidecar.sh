#!/usr/bin/env bash
set -euo pipefail

# Compile the desktop agent sidecar. bun build --compile writes a
# `.{hex}-00000000.bun-build` scratch Mach-O into cwd, then renames it to
# --outfile. Interrupted compiles (sidecar watch, Ctrl+C) leave those ~60MB
# copies in the repo root. Run from a temp dir so leftovers never land here.
# See https://github.com/oven-sh/bun/issues/14020

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENTRY="$ROOT/src/agent/entry.ts"
# bun --compile on Windows writes an .exe; Tauri's sidecar lookup requires it.
EXE_SUFFIX=""
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) EXE_SUFFIX=".exe" ;;
esac
OUT="$ROOT/dist/sidecar/ht-agent${EXE_SUFFIX}"

mkdir -p "$(dirname "$OUT")"

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/harnesstap-sidecar-XXXX")"
cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

# The compiled binary cannot read package.json at runtime (it is not in the
# bunfs), so bake the version in the same way tsup does for the npm build.
VERSION="$(cd "$ROOT" && bun --print 'require("./package.json").version')"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.+-]+)?$ ]]; then
  echo "build-sidecar: unexpected package.json version: '$VERSION'" >&2
  exit 1
fi

cd "$WORKDIR"
bun build --compile "$ENTRY" --define "__HT_VERSION__=\"$VERSION\"" --outfile "$OUT"
