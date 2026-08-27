#!/usr/bin/env bash
# Wrapper around Tauri's linuxdeploy-plugin-gtk.
#
# linuxdeploy's GTK plugin re-invokes linuxdeploy, which runs `ldd` on every
# ELF in AppDir/usr/bin. Tauri copies bundle.externalBin there, including the
# Bun --compile ht-agent sidecar. Bun standalones are not ldd-compatible, so
# ldd exits 1 and linuxdeploy SIGABRTs (std::runtime_error, exit 134).
# strip/patchelf on that ELF can also corrupt the bunfs trailer.
#
# HARNESSTAP_LINUXDEPLOY_GTK_WRAPPER
# This wrapper moves usr/bin/ht-agent aside by sidecar name (not system ldd)
# for the GTK pass and restores it before returning, so it still lands in the
# AppImage next to the desktop executable. Seeded into
# ~/.cache/tauri/linuxdeploy-plugin-gtk.sh and symlinked next to extracted
# linuxdeploy AppRun so that is the plugin linuxdeploy actually loads.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
UPSTREAM="${LINUXDEPLOY_PLUGIN_GTK_UPSTREAM:-$SCRIPT_DIR/linuxdeploy-plugin-gtk.upstream.sh}"
UPSTREAM_URL="https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh"
# shellcheck source=linuxdeploy-shelter.sh
. "$SCRIPT_DIR/linuxdeploy-shelter.sh"

if [ "${1:-}" = "--plugin-api-version" ]; then
  echo 0
  exit 0
fi

if [ "${1:-}" = "--help" ]; then
  echo "Usage: $0 --appdir <AppDir>"
  exit 0
fi

ensure_upstream() {
  if [ -f "$UPSTREAM" ]; then
    chmod +x "$UPSTREAM" || true
    return 0
  fi
  mkdir -p "$(dirname "$UPSTREAM")"
  curl -fsSL "$UPSTREAM_URL" -o "$UPSTREAM"
  chmod +x "$UPSTREAM"
}

parse_appdir() {
  local prev=""
  local arg
  for arg in "$@"; do
    if [ "$prev" = "--appdir" ]; then
      printf '%s' "$arg"
      return 0
    fi
    case "$arg" in
      --appdir=*)
        printf '%s' "${arg#--appdir=}"
        return 0
        ;;
    esac
    prev="$arg"
  done
  return 1
}

APPDIR=""
if APPDIR_VALUE="$(parse_appdir "$@")"; then
  APPDIR="$APPDIR_VALUE"
fi

ensure_upstream

if [ -z "$APPDIR" ] || [ ! -d "$APPDIR/usr/bin" ]; then
  exec "$UPSTREAM" "$@"
fi

SHELTER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/linuxdeploy-gtk-shelter.XXXXXX")"

restore_sheltered() {
  if [ -d "$SHELTER_DIR" ]; then
    local f
    shopt -s nullglob
    for f in "$SHELTER_DIR"/*; do
      mv "$f" "$APPDIR/usr/bin/"
    done
    rmdir "$SHELTER_DIR" 2>/dev/null || true
  fi
}

trap restore_sheltered EXIT

echo "HARNESSTAP_LINUXDEPLOY_GTK_WRAPPER"
linuxdeploy_shelter_usr_bin "$APPDIR" "$SHELTER_DIR"
if [ -e "$APPDIR/usr/bin/ht-agent" ]; then
  echo "linuxdeploy-plugin-gtk: ht-agent still in usr/bin after shelter" >&2
  exit 1
fi

"$UPSTREAM" "$@"
