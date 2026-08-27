#!/usr/bin/env bash
# Pre-extract linuxdeploy (and the appimage output plugin) and install:
#   - ELF stub at ~/.cache/tauri/linuxdeploy-${ARCH}.AppImage (dd-safe)
#   - linuxdeploy-wrap.sh (shelters Bun sidecar, then execs extracted AppRun)
#   - linuxdeploy-plugin-appimage.AppImage ELF stub (name tauri-bundler uses)
#   - linuxdeploy-plugin-gtk.sh wrapper (gtk re-invoke still ldd's usr/bin)
#
# Tauri caches tools only under ~/.cache/tauri (or target/.tauri) and skips
# download when the file already exists, then `dd`s three zero bytes at
# offset 8 of linuxdeploy-*.AppImage. A compiled ELF survives that dd.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CACHE="${LINUXDEPLOY_CACHE_DIR:-${HOME}/.cache/tauri}"
mkdir -p "$CACHE"

case "$(uname -m)" in
  x86_64) ARCH=x86_64 ;;
  aarch64 | arm64) ARCH=aarch64 ;;
  *)
    echo "seed-linuxdeploy: unsupported arch $(uname -m)" >&2
    exit 1
    ;;
esac

squashfs_offset() {
  python3 -c "
import struct
import sys

path = sys.argv[1]
data = open(path, 'rb').read()
magics = (b'hsqs', b'sqsh')

def is_magic(offset):
    return offset >= 0 and offset + 4 <= len(data) and data[offset:offset + 4] in magics

candidates = []
if data[:4] == b'\\x7fELF':
    ei_class = data[4]
    if ei_class == 2:
        e_shoff = struct.unpack_from('<Q', data, 40)[0]
        e_shentsize, e_shnum = struct.unpack_from('<HH', data, 58)
    elif ei_class == 1:
        e_shoff = struct.unpack_from('<I', data, 32)[0]
        e_shentsize, e_shnum = struct.unpack_from('<HH', data, 46)
    else:
        e_shoff = e_shentsize = e_shnum = 0
    elf_end = e_shoff + e_shentsize * e_shnum
    if is_magic(elf_end):
        print(elf_end)
        sys.exit(0)
    candidates.append(elf_end)

for step in (4096, 512):
    start = step
    if candidates:
        start = max(step, (candidates[0] + step - 1) // step * step)
    i = start
    while i + 4 <= len(data):
        if is_magic(i):
            print(i)
            sys.exit(0)
        i += step
sys.exit(1)
" "$1"
}

extract_appimage() {
  local img="$1"
  local dest="$2"
  rm -rf "$dest"
  mkdir -p "$(dirname "$dest")"
  chmod +x "$img"

  local offset=""
  if command -v unsquashfs >/dev/null && offset="$(squashfs_offset "$img")"; then
    if unsquashfs -f -d "$dest" -o "$offset" "$img" >/dev/null; then
      return 0
    fi
    echo "seed-linuxdeploy: unsquashfs offset $offset failed; trying --appimage-extract" >&2
    rm -rf "$dest"
  else
    echo "seed-linuxdeploy: no squashfs offset; trying --appimage-extract" >&2
  fi

  local tmp
  tmp="$(mktemp -d)"
  (
    cd "$tmp"
    APPIMAGE_EXTRACT_AND_RUN=1 "$img" --appimage-extract >/dev/null
  )
  mv "$tmp/squashfs-root" "$dest"
  rm -rf "$tmp"
}

compile_stub() {
  local dest="$1"
  local wrap_sh="$2"
  gcc -O2 -o "$dest" \
    -DWRAP_SH="\"$wrap_sh\"" \
    "$ROOT/apps/desktop/scripts/linuxdeploy-stub.c"
  chmod +x "$dest"
}

LINUXDEPLOY_IMG="$CACHE/linuxdeploy-${ARCH}.AppImage.download"
curl -fsSL \
  "https://github.com/tauri-apps/binary-releases/releases/download/linuxdeploy/linuxdeploy-${ARCH}.AppImage" \
  -o "$LINUXDEPLOY_IMG"
extract_appimage "$LINUXDEPLOY_IMG" "$CACHE/linuxdeploy-extracted"
rm -f "$LINUXDEPLOY_IMG"
test -x "$CACHE/linuxdeploy-extracted/AppRun"

PLUGIN_IMG="$CACHE/linuxdeploy-plugin-appimage-${ARCH}.AppImage.download"
curl -fsSL \
  "https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/continuous/linuxdeploy-plugin-appimage-${ARCH}.AppImage" \
  -o "$PLUGIN_IMG"
extract_appimage "$PLUGIN_IMG" "$CACHE/linuxdeploy-plugin-appimage-extracted"
rm -f "$PLUGIN_IMG"
test -x "$CACHE/linuxdeploy-plugin-appimage-extracted/AppRun"

cp "$ROOT/apps/desktop/scripts/linuxdeploy-wrap.sh" "$CACHE/linuxdeploy-wrap.sh"
chmod +x "$CACHE/linuxdeploy-wrap.sh"
compile_stub "$CACHE/linuxdeploy-${ARCH}.AppImage" "$CACHE/linuxdeploy-wrap.sh"

# tauri-bundler looks for linuxdeploy-plugin-appimage.AppImage (no arch suffix).
# linuxdeploy itself searches the same directory as the linuxdeploy binary.
compile_stub \
  "$CACHE/linuxdeploy-plugin-appimage.AppImage" \
  "$CACHE/linuxdeploy-plugin-appimage-extracted/AppRun"
cp -a "$CACHE/linuxdeploy-plugin-appimage.AppImage" \
  "$CACHE/linuxdeploy-plugin-appimage-${ARCH}.AppImage"

curl -fsSL \
  https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh \
  -o "$CACHE/linuxdeploy-plugin-gtk.upstream.sh"
cp "$ROOT/apps/desktop/scripts/linuxdeploy-plugin-gtk.sh" "$CACHE/linuxdeploy-plugin-gtk.sh"
chmod +x "$CACHE/linuxdeploy-plugin-gtk.sh" "$CACHE/linuxdeploy-plugin-gtk.upstream.sh"

# Extracted AppRun looks for plugins next to itself, not only in ~/.cache/tauri.
ln -sfn "$CACHE/linuxdeploy-plugin-gtk.sh" \
  "$CACHE/linuxdeploy-extracted/linuxdeploy-plugin-gtk.sh"
ln -sfn "$CACHE/linuxdeploy-plugin-gtk.upstream.sh" \
  "$CACHE/linuxdeploy-extracted/linuxdeploy-plugin-gtk.upstream.sh"
ln -sfn "$CACHE/linuxdeploy-plugin-appimage.AppImage" \
  "$CACHE/linuxdeploy-extracted/linuxdeploy-plugin-appimage.AppImage"

# Local mtime newer than GitHub assets so a wget -N style fetch would keep stubs.
touch \
  "$CACHE/linuxdeploy-${ARCH}.AppImage" \
  "$CACHE/linuxdeploy-plugin-appimage.AppImage" \
  "$CACHE/linuxdeploy-plugin-appimage-${ARCH}.AppImage" \
  "$CACHE/linuxdeploy-plugin-gtk.sh"

echo "seed-linuxdeploy: ${ARCH} linuxdeploy + plugin-appimage extracted; gtk plugin wrapper seeded"
