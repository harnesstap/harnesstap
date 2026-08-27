# Sourced by linuxdeploy-wrap.sh and linuxdeploy-plugin-gtk.sh.
# Release #7 (run 33038637927): system `ldd` exited 0 on Bun --compile
# usr/bin/ht-agent, so wrap/gtk kept it; linuxdeploy's internal ldd then
# exited 1 and SIGABRTed (gtk upstream.sh:296). Do not key shelter on
# system ldd success.

linuxdeploy_should_shelter() {
  local bin="$1"
  local base="${bin##*/}"

  case "$base" in
    ht-agent)
      return 0
      ;;
  esac

  if grep -a -q -F bunfs "$bin" 2>/dev/null; then
    return 0
  fi

  if [ -x "$bin" ] && ! ldd "$bin" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

linuxdeploy_shelter_usr_bin() {
  local appdir="$1"
  local dest="$2"
  local bin
  shopt -s nullglob
  for bin in "$appdir/usr/bin"/*; do
    [ -f "$bin" ] || continue
    if linuxdeploy_should_shelter "$bin"; then
      echo "Sheltering sidecar from linuxdeploy: $bin"
      mv "$bin" "$dest/"
    fi
  done
  if [ -e "$appdir/usr/bin/ht-agent" ]; then
    echo "Sheltering sidecar from linuxdeploy: $appdir/usr/bin/ht-agent"
    mv "$appdir/usr/bin/ht-agent" "$dest/"
  fi
}
