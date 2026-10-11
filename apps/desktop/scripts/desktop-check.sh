#!/usr/bin/env bash
set -euo pipefail

# Visual + a11y check for Desktop web mode. Expects a running Vite server and
# ht-agent (see apps/desktop/scripts/demo-home.sh). Env: SHOTS_BASE_URL,
# SHOTS_AGENT_PORT, SHOTS_TOKEN_PATH, SHOTS_PROJECT_PATH.
#
# The four walks are independent (own browser, own context), so they run side
# by side. Only the compare walks write into e2e/artifacts/shots; the other two
# get their own SHOTS_OUT so they cannot overwrite a PNG before it is compared.
# Per-walk logs print in a fixed order once every walk has finished.

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/apps/desktop"

ARTIFACTS="$ROOT/apps/desktop/e2e/artifacts"
LOGS="$ARTIFACTS/logs"
mkdir -p "$LOGS"

NAMES=()
PIDS=()

start_walk() {
  local name="$1"
  local out="$2"
  shift 2
  NAMES+=("$name")
  (
    start=$SECONDS
    status=0
    SHOTS_OUT="$out" node scripts/ui-shots.mjs "$@" >"$LOGS/$name.log" 2>&1 || status=$?
    echo "walk $name: exit $status in $((SECONDS - start))s" >>"$LOGS/$name.log"
    exit "$status"
  ) &
  PIDS+=("$!")
}

start_walk compare-1440x900 "$ARTIFACTS/shots" --compare --axe --viewports 1440x900
start_walk compare-960x640 "$ARTIFACTS/shots" --compare --axe --viewports 960x640
start_walk reduced-motion "$ARTIFACTS/shots-reduced-motion" --reduced-motion --axe --viewports 1440x900
start_walk trace "$ARTIFACTS/shots-trace" --trace --viewports 1440x900

failed=0
for i in "${!PIDS[@]}"; do
  if wait "${PIDS[$i]}"; then
    echo "::group::${NAMES[$i]}"
    cat "$LOGS/${NAMES[$i]}.log"
    echo "::endgroup::"
  else
    failed=1
    echo "::error::walk ${NAMES[$i]} failed"
    cat "$LOGS/${NAMES[$i]}.log"
  fi
done

exit "$failed"
