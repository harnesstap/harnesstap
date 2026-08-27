#!/usr/bin/env bash
# Invoked via the ELF stub at ~/.cache/tauri/linuxdeploy-${ARCH}.AppImage.
#
# Release #6 (run 33032582858): linuxdeploy started with
# --appimage-extract-and-run (not a FUSE launch failure), deployed
# usr/bin/harnesstap-desktop, then:
#   1. first pass: ldd + patchelf rpath on usr/bin/ht-agent (Bun --compile)
#   2. gtk plugin re-invoke: ldd ht-agent -> SIGABRT (exit 134)
#
# This wrapper keeps ldd-incompatible usr/bin ELFs out of both scans, then
# restores them before plugin-appimage so they still sit next to the desktop
# exe. Recurses through the gtk plugin's $LINUXDEPLOY re-invoke: skip a second
# shelter/restore so ht-agent stays aside until the outer pass finishes.
#
# --output appimage is split out and handed to the extracted plugin-appimage
# AppRun. Re-running linuxdeploy with --output would ldd usr/bin again.

set -euo pipefail

CACHE_DIR="${LINUXDEPLOY_CACHE_DIR:-${HOME}/.cache/tauri}"
EXTRACTED="${LINUXDEPLOY_EXTRACTED:-$CACHE_DIR/linuxdeploy-extracted}"
APPRUN="${LINUXDEPLOY_EXTRACTED_APPRUN:-${LINUXDEPLOY_APPRUN:-$EXTRACTED/AppRun}}"
PLUGIN_APPRUN="${LINUXDEPLOY_PLUGIN_APPIMAGE_APPRUN:-$CACHE_DIR/linuxdeploy-plugin-appimage-extracted/AppRun}"

if [ ! -x "$APPRUN" ]; then
  echo "linuxdeploy-wrap: missing extracted AppRun at $APPRUN" >&2
  exit 1
fi

if [ -n "${LINUXDEPLOY_STUB:-}" ]; then
  export LINUXDEPLOY="$LINUXDEPLOY_STUB"
  export APPIMAGE="$LINUXDEPLOY_STUB"
fi
export PATH="$CACHE_DIR:$(dirname "$APPRUN"):${PATH:-}"

if [ "${LINUXDEPLOY_WRAP_ACTIVE:-}" = "1" ]; then
  exec "$APPRUN" "$@"
fi
export LINUXDEPLOY_WRAP_ACTIVE=1

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

filtered=()
want_output=0
skip_next=0
prev=""
for arg in "$@"; do
  if [ "$skip_next" = 1 ]; then
    skip_next=0
    if [ "$prev" = "--output" ] && [ "$arg" = "appimage" ]; then
      want_output=1
      prev=""
      continue
    fi
    filtered+=("$arg")
    prev="$arg"
    continue
  fi
  case "$arg" in
    --appimage-extract-and-run)
      prev="$arg"
      continue
      ;;
    --output)
      skip_next=1
      prev="$arg"
      continue
      ;;
    --output=appimage)
      want_output=1
      prev="$arg"
      continue
      ;;
    --output=*)
      filtered+=("$arg")
      prev="$arg"
      continue
      ;;
    *)
      filtered+=("$arg")
      prev="$arg"
      ;;
  esac
done

SHELTER_DIR=""
restore_sheltered() {
  if [ -n "$SHELTER_DIR" ] && [ -d "$SHELTER_DIR" ]; then
    local f
    shopt -s nullglob
    for f in "$SHELTER_DIR"/*; do
      mv "$f" "$APPDIR/usr/bin/"
    done
    rmdir "$SHELTER_DIR" 2>/dev/null || true
    SHELTER_DIR=""
  fi
}
trap restore_sheltered EXIT

if [ -n "$APPDIR" ] && [ -d "$APPDIR/usr/bin" ]; then
  SHELTER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/linuxdeploy-shelter.XXXXXX")"
  shopt -s nullglob
  for bin in "$APPDIR/usr/bin"/*; do
    [ -f "$bin" ] || continue
    [ -x "$bin" ] || continue
    if ldd "$bin" >/dev/null 2>&1; then
      continue
    fi
    echo "Sheltering ldd-incompatible binary from linuxdeploy: $bin"
    mv "$bin" "$SHELTER_DIR/"
  done
fi

set +e
"$APPRUN" "${filtered[@]}"
status=$?
set -e
restore_sheltered
trap - EXIT
if [ "$status" -ne 0 ]; then
  exit "$status"
fi

if [ "$want_output" = 1 ]; then
  if [ -z "$APPDIR" ]; then
    echo "linuxdeploy-wrap: --output appimage without --appdir" >&2
    exit 1
  fi
  if [ ! -x "$PLUGIN_APPRUN" ]; then
    echo "linuxdeploy-wrap: missing extracted plugin-appimage AppRun at $PLUGIN_APPRUN" >&2
    exit 1
  fi
  exec "$PLUGIN_APPRUN" --appdir "$APPDIR" --output appimage
fi
