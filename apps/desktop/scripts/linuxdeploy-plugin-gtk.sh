#!/usr/bin/env bash
# Wrapper around Tauri's linuxdeploy-plugin-gtk.
#
# linuxdeploy's GTK plugin re-invokes linuxdeploy, which runs `ldd` on every
# ELF in AppDir/usr/bin. Tauri copies bundle.externalBin there, including the
# Bun --compile ht-agent sidecar. Bun standalones are not ldd-compatible, so
# ldd exits 1 and linuxdeploy SIGABRTs (std::runtime_error, exit 134).
# strip/patchelf on that ELF can also corrupt the bunfs trailer.
#
# This wrapper moves ldd-incompatible usr/bin files aside for the GTK pass and
# restores them before returning, so they still land in the AppImage next to
# the desktop executable (sidecar_binary_path / tauri-plugin-shell externalBin).
#
# Seeded into ~/.cache/tauri/linuxdeploy-plugin-gtk.sh before `tauri bundle`
# so tauri-bundler reuses it instead of downloading the upstream script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
UPSTREAM="${LINUXDEPLOY_PLUGIN_GTK_UPSTREAM:-$SCRIPT_DIR/linuxdeploy-plugin-gtk.upstream.sh}"
UPSTREAM_URL="https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh"

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

shopt -s nullglob
for bin in "$APPDIR/usr/bin"/*; do
  [ -f "$bin" ] || continue
  [ -x "$bin" ] || continue
  if ldd "$bin" >/dev/null 2>&1; then
    continue
  fi
  echo "Sheltering ldd-incompatible binary from linuxdeploy GTK scan: $bin"
  mv "$bin" "$SHELTER_DIR/"
done

"$UPSTREAM" "$@"
