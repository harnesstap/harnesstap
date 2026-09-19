#!/usr/bin/env bash
set -euo pipefail

# Visual + a11y check for Desktop web mode. Expects a running Vite server and
# ht-agent (see apps/desktop/scripts/demo-home.sh). Env: SHOTS_BASE_URL,
# SHOTS_AGENT_PORT, SHOTS_TOKEN_PATH, SHOTS_PROJECT_PATH.

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/apps/desktop"

node scripts/ui-shots.mjs --compare --axe
node scripts/ui-shots.mjs --reduced-motion --axe --viewports 1440x900
node scripts/ui-shots.mjs --trace --viewports 1440x900
