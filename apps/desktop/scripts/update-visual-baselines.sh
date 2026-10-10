#!/usr/bin/env bash
set -euo pipefail

# Refresh e2e/visual baselines inside the pinned Playwright image (G8).
# Host Chrome / host fonts are not allowed: that is what made baselines drift.

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/apps/desktop/scripts/visual-pin.env"

if ! command -v docker >/dev/null 2>&1; then
  echo "update-visual-baselines: docker is required so shots match CI fonts and Chromium." >&2
  echo "Without Docker, dispatch desktop-e2e with update_baselines=true and copy the desktop-visual-baselines artifact into apps/desktop/e2e/visual/." >&2
  exit 1
fi

docker run --rm \
  -v "$ROOT:/work" \
  -w /work \
  -e CI=1 \
  -e SHOTS_PINNED_IMAGE=1 \
  "$PLAYWRIGHT_IMAGE" \
  bash -lc '
    set -euo pipefail
    if ! command -v unzip >/dev/null 2>&1; then
      apt-get update
      apt-get install -y --no-install-recommends unzip
    fi
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    bun install --frozen-lockfile
    cd apps/desktop && bun install --frozen-lockfile
    cd /work
    HT_DEMO_ROOT=/tmp/htdemo HARNESSTAP_AGENT_PORT=7474 \
      bash apps/desktop/scripts/demo-home.sh &
    for i in $(seq 1 40); do
      curl -sf http://127.0.0.1:7474/v1/health && break
      sleep 1
    done
    curl -sf http://127.0.0.1:7474/v1/health
    cd apps/desktop && VITE_AGENT_URL=http://127.0.0.1:7474 \
      bunx vite --host 127.0.0.1 --port 5173 --strictPort &
    for i in $(seq 1 40); do
      curl -sf http://127.0.0.1:5173/ >/dev/null && break
      sleep 1
    done
    curl -sf http://127.0.0.1:5173/ >/dev/null
    export SHOTS_BASE_URL=http://127.0.0.1:5173/
    export SHOTS_AGENT_PORT=7474
    export SHOTS_TOKEN_PATH=/tmp/htdemo/home/.harnesstap/agent-token
    export SHOTS_PROJECT_PATH=/tmp/htdemo/project
    export SHOTS_PINNED_IMAGE=1
    cd /work/apps/desktop
    node scripts/ui-shots.mjs --update-baselines
  '
