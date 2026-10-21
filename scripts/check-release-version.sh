#!/usr/bin/env bash
# Build and pack the CLI the way `npm publish` does, then check that the packed
# `ht --version` prints the plain package.json version (no `-dev+<sha>`).
#
# `npm publish` runs `prepublishOnly`, which rebuilds dist/. That rebuild must
# be a release build on its own: harnesstap 1.4.0 shipped as 1.4.0-dev+9dcdc1f
# because only the earlier build step had HT_RELEASE=1 (issue #501).
set -euo pipefail

cd "$(dirname "$0")/.."
expected="$(node -p 'require("./package.json").version')"
work="$(mktemp -d "${PWD}/.release-version-check.XXXXXX")"
trap 'rm -rf "$work"' EXIT

# The release flags must come from prepublishOnly, not the caller.
env -u HT_RELEASE -u HARNESSTAP_RELEASE npm run --silent prepublishOnly
npm pack --ignore-scripts --silent --pack-destination "$work" >/dev/null
tarball="$(ls "$work"/harnesstap-*.tgz)"
tar -xzf "$tarball" -C "$work"

# Unpacked inside the checkout so the CLI resolves this repo's node_modules.
actual="$(node "$work/package/dist/bin.js" --version)"
if [ "$actual" != "$expected" ]; then
  echo "Packed CLI reports '$actual', expected '$expected' from package.json." >&2
  exit 1
fi
echo "Packed CLI reports $actual, matching package.json."
