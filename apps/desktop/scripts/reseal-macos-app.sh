#!/usr/bin/env bash
# Ad-hoc reseal HarnessTap.app after Tauri's unsigned macOS bundle.
#
# Tauri leaves a linker signature with Sealed Resources=none. Gatekeeper then
# maps that to "HarnessTap.app is damaged" once Chrome quarantine is set.
# `codesign --force --deep --sign -` writes CodeResources. No Developer ID.
#
# Usage: bash apps/desktop/scripts/reseal-macos-app.sh [bundle-dir]
# bundle-dir defaults to apps/desktop/src-tauri/target/release/bundle.
#
# Env:
#   RESEAL_REQUIRE=1   fail instead of skip when not Darwin (CI macOS jobs)
#   RESEAL_UNAME       override `uname -s` (tests)
#   RESEAL_APP         override path to HarnessTap.app
#   RESEAL_CODESIGN    codesign binary (tests)
#   RESEAL_HDIUTIL     hdiutil binary (tests)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BUNDLE_DIR="${1:-$REPO_ROOT/apps/desktop/src-tauri/target/release/bundle}"
UNAME="${RESEAL_UNAME:-$(uname -s)}"

log() {
  echo "reseal-macos-app: $*"
}

if [ "$UNAME" != "Darwin" ]; then
  if [ "${RESEAL_REQUIRE:-}" = "1" ]; then
    echo "reseal-macos-app: required on Darwin, got $UNAME" >&2
    exit 1
  fi
  log "skipping on $UNAME"
  exit 0
fi

APP="${RESEAL_APP:-$BUNDLE_DIR/macos/HarnessTap.app}"
if [ ! -d "$APP" ]; then
  echo "reseal-macos-app: missing app bundle at $APP" >&2
  exit 1
fi

CODESIGN="${RESEAL_CODESIGN:-codesign}"
HDIUTIL="${RESEAL_HDIUTIL:-hdiutil}"

sign_adhoc() {
  local target="$1"
  log "codesign --force --sign - $target"
  "$CODESIGN" --force --sign - "$target"
}

MACOS_DIR="$APP/Contents/MacOS"
if [ -d "$MACOS_DIR" ]; then
  for bin in "$MACOS_DIR"/*; do
    [ -e "$bin" ] || continue
    [ -d "$bin" ] && continue
    sign_adhoc "$bin"
  done
fi

log "codesign --force --deep --sign - $APP"
"$CODESIGN" --force --deep --sign - "$APP"

dump="$("$CODESIGN" -dv --verbose=4 "$APP" 2>&1 || true)"
printf '%s\n' "$dump"
if printf '%s\n' "$dump" | grep -q 'Sealed Resources=none'; then
  echo "reseal-macos-app: Sealed Resources=none after reseal" >&2
  exit 1
fi
if ! printf '%s\n' "$dump" | grep -Eq 'Sealed Resources'; then
  echo "reseal-macos-app: codesign -dv did not report Sealed Resources" >&2
  exit 1
fi
log "sealed HarnessTap.app (Sealed Resources present)"

DMG_DIR="$BUNDLE_DIR/dmg"
mkdir -p "$DMG_DIR"
shopt -s nullglob
dmgs=("$DMG_DIR"/*.dmg)
if [ ${#dmgs[@]} -eq 0 ]; then
  echo "reseal-macos-app: no existing DMG to replace under $DMG_DIR" >&2
  exit 1
fi

STAGING="$(mktemp -d)"
cleanup() {
  rm -rf "$STAGING"
}
trap cleanup EXIT

mkdir -p "$STAGING/src"
if command -v ditto >/dev/null 2>&1; then
  ditto "$APP" "$STAGING/src/HarnessTap.app"
else
  cp -R "$APP" "$STAGING/src/HarnessTap.app"
fi
ln -s /Applications "$STAGING/src/Applications"

for dmg in "${dmgs[@]}"; do
  log "recreating $(basename "$dmg") from sealed app"
  rm -f "$dmg"
  "$HDIUTIL" create -volname HarnessTap -srcfolder "$STAGING/src" -ov -format UDZO "$dmg"
done

log "done"
