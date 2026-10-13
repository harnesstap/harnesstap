#!/usr/bin/env bash
set -euo pipefail

# Visual + a11y check for Desktop web mode. Expects a running Vite server and
# ht-agent (see apps/desktop/scripts/demo-home.sh). Env: SHOTS_BASE_URL,
# SHOTS_AGENT_PORT, SHOTS_TOKEN_PATH, SHOTS_PROJECT_PATH.
#
# --suite runs four walks at once in one Chromium: compare at 1440x900,
# compare at 960x640, reduced motion, and trace. One browser shares the
# font cache, so the parallel shots match the sequential baselines. Compare
# walks write e2e/artifacts/shots. The other two use their own directories
# so they cannot overwrite a PNG before it is compared.

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/apps/desktop"

exec node scripts/ui-shots.mjs --suite
