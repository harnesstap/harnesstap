#!/usr/bin/env bash
# Runs one HarnessTap build (the original or a Rust build) for app record and
# app replay: a fresh HOME per run, network calls refused (proxy and service URLs point at 127.0.0.1:9), telemetry off, no color, and a
# fixed version string. Usage: bash rust/run-sandboxed.sh <command> [args...]
set -u
home="$(mktemp -d "${TMPDIR:-/tmp}/ht-home.XXXXXX")"
trap 'rm -rf "$home"' EXIT
export HOME="$home"
export XDG_CONFIG_HOME="$home/.config" XDG_DATA_HOME="$home/.local/share" XDG_CACHE_HOME="$home/.cache" XDG_STATE_HOME="$home/.local/state"
export HARNESSTAP_TELEMETRY=0 NO_COLOR=1 FORCE_COLOR=0 TERM=dumb CI=1 TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8
export BROWSER=true EDITOR=true VISUAL=true GIT_TERMINAL_PROMPT=0
export HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 http_proxy=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9 NO_PROXY= NODE_USE_ENV_PROXY=1
export HARNESSTAP_CLOUD_URL=http://127.0.0.1:9 HARNESSTAP_MCP_REGISTRY_URL=http://127.0.0.1:9 HARNESSTAP_NO_INTERACTIVE=1
unset HARNESSTAP_HOME HARNESSTAP_DEBUG GITHUB_TOKEN GH_TOKEN HARNESSTAP_TOKEN HARNESSTAP_CLOUD_TOKEN
"$@"
