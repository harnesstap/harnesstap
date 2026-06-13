#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DETAILS="$ROOT/docs/scenarios/details"

FORBIDDEN=(
  '--platform'
  'layer attach'
  'layer detach'
  'layer add '
  'project sync'
  'cloud login'
  'built-in starter'
)

failures=0
for pattern in "${FORBIDDEN[@]}"; do
  if rg -n --fixed-strings "$pattern" "$DETAILS" >/tmp/scenario-docs-drift.txt 2>/dev/null; then
    echo "Forbidden pattern in scenario docs: $pattern"
    cat /tmp/scenario-docs-drift.txt
    failures=$((failures + 1))
  fi
done

if [[ "$failures" -gt 0 ]]; then
  echo "Scenario docs drift check failed ($failures pattern group(s))."
  exit 1
fi

echo "Scenario docs drift check passed."
