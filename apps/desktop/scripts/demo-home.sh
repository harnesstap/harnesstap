#!/usr/bin/env bash
set -euo pipefail

# Assemble an isolated HOME + project from the test fixtures and run ht-agent
# against it. Pair with `bun run dev` (VITE_AGENT_URL) or `bun run shots`.
#
#   HT_DEMO_ROOT          where to build the demo tree (default /tmp/htdemo)
#   HARNESSTAP_AGENT_PORT forwarded to the agent (default 7474)

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DEMO_ROOT="${HT_DEMO_ROOT:-/tmp/htdemo}"
DEMO_HOME="$DEMO_ROOT/home"
DEMO_PROJECT="$DEMO_ROOT/project"
FIXTURES="$REPO_ROOT/test/fixtures"

rm -rf "$DEMO_ROOT"
mkdir -p "$DEMO_HOME" "$DEMO_PROJECT"

cp -R "$FIXTURES/claude-plugins-home/." "$DEMO_HOME/"
cp -R "$FIXTURES/cursor-plugins-home/." "$DEMO_HOME/"
cp -R "$FIXTURES/cursor-project/." "$DEMO_PROJECT/"
cp -R "$FIXTURES/claude-project/." "$DEMO_PROJECT/"

# Fixtures may carry state from earlier local runs; the agent seeds its own.
rm -rf "$DEMO_HOME/.harnessdeck" "$DEMO_HOME/.harnesstap" \
  "$DEMO_PROJECT/.harnessdeck" "$DEMO_PROJECT/.harnesstap"

echo "demo-home: HOME=$DEMO_HOME"
echo "demo-home: project=$DEMO_PROJECT"
echo "demo-home: token=$DEMO_HOME/.harnesstap/agent-token"

cd "$REPO_ROOT"
export HOME="$DEMO_HOME"
export HARNESSTAP_TELEMETRY=0
# HARNESSTAP_HOME would override HOME/.harnesstap and leak state out of the demo.
unset HARNESSTAP_HOME
exec bun src/agent/entry.ts
