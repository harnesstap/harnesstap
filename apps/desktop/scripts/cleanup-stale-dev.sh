#!/usr/bin/env bash
set -euo pipefail

# Stop orphaned HarnessTap desktop dev processes from a previous `desktop:dev`
# session (e.g. terminal closed without SIGTERM). Safe to run before every start.
# Stale app instances matter because Tauri's single-instance plugin makes any
# new launch exit silently while the orphaned window stays open without a
# working sidecar.

AGENT_PORT_START="${HARNESSTAP_AGENT_PORT:-7474}"
AGENT_PORT_END=$((AGENT_PORT_START + 5))
VITE_PORT=1420
HMR_PORT=1421

resolve_harnesstap_home() {
  if [[ -n "${HARNESSTAP_HOME:-}" ]]; then
    echo "$HARNESSTAP_HOME"
    return
  fi
  if [[ -n "${HOME:-}" ]]; then
    echo "$HOME/.harnesstap"
    return
  fi
  if [[ -n "${USERPROFILE:-}" ]]; then
    echo "$USERPROFILE/.harnesstap"
    return
  fi
  echo ""
}

pids_listening_on_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
    return
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$port" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true
  fi
}

stop_pids() {
  local label="$1"
  shift
  local pids=("$@")
  if [[ ${#pids[@]} -eq 0 ]]; then
    return
  fi

  local joined
  joined="$(printf '%s ' "${pids[@]}")"
  echo "Stopping $label (PID ${joined% })"

  kill "${pids[@]}" 2>/dev/null || true
  sleep 0.25

  local still_running=()
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      still_running+=("$pid")
    fi
  done

  if [[ ${#still_running[@]} -gt 0 ]]; then
    kill -9 "${still_running[@]}" 2>/dev/null || true
  fi
}

stop_port() {
  local port="$1"
  local pids_raw
  pids_raw="$(pids_listening_on_port "$port")"
  if [[ -z "$pids_raw" ]]; then
    return
  fi

  local pids=()
  while IFS= read -r pid; do
    [[ -n "$pid" ]] && pids+=("$pid")
  done <<<"$pids_raw"

  stop_pids "listener on port $port" "${pids[@]}"
}

stop_ht_agent_processes() {
  if ! command -v pgrep >/dev/null 2>&1; then
    return
  fi

  local pids_raw
  pids_raw="$(
    pgrep -f '(^|/)ht-agent(-[A-Za-z0-9._-]+)?$' 2>/dev/null || true
  )"
  if [[ -z "$pids_raw" ]]; then
    return
  fi

  local pids=()
  while IFS= read -r pid; do
    [[ -n "$pid" ]] && pids+=("$pid")
  done <<<"$pids_raw"

  stop_pids "ht-agent sidecar" "${pids[@]}"
}

stop_stale_dev_app_processes() {
  if ! command -v pgrep >/dev/null 2>&1; then
    return
  fi

  # Cargo-built dev/e2e binaries only (target/debug|release). Installed release
  # builds run as HarnessTap.app/Contents/MacOS/HarnessTap and are left alone.
  local pids_raw
  pids_raw="$(pgrep -f '(^|/)harnesstap-desktop$' 2>/dev/null || true)"
  if [[ -z "$pids_raw" ]]; then
    return
  fi

  local pids=()
  while IFS= read -r pid; do
    [[ -n "$pid" ]] && pids+=("$pid")
  done <<<"$pids_raw"

  stop_pids "stale harnesstap-desktop app" "${pids[@]}"
}

remove_stale_agent_files() {
  local home
  home="$(resolve_harnesstap_home)"
  if [[ -z "$home" || ! -d "$home" ]]; then
    return
  fi

  local removed=0
  for file in agent-port agent-token; do
    local path="$home/$file"
    if [[ -f "$path" ]]; then
      if rm -f "$path" 2>/dev/null; then
        echo "Removed stale $path"
        removed=1
      else
        echo "Warning: could not remove $path (permission denied?)" >&2
      fi
    fi
  done

  if [[ "$removed" -eq 0 ]]; then
    echo "No stale agent session files in $home"
  fi
}

echo "Cleaning up stale HarnessTap desktop dev processes…"

harnesstap_home="$(resolve_harnesstap_home)"
if [[ -n "$harnesstap_home" && -f "$harnesstap_home/agent-port" ]]; then
  recorded_port="$(tr -d '[:space:]' <"$harnesstap_home/agent-port" 2>/dev/null || true)"
  if [[ "$recorded_port" =~ ^[0-9]+$ ]]; then
    stop_port "$recorded_port"
  fi
fi

for port in $(seq "$AGENT_PORT_START" "$AGENT_PORT_END"); do
  stop_port "$port"
done

stop_port "$VITE_PORT"
stop_port "$HMR_PORT"
stop_ht_agent_processes
stop_stale_dev_app_processes
remove_stale_agent_files

echo "Desktop dev cleanup complete."
