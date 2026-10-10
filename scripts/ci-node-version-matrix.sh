#!/usr/bin/env bash
# G1: install the packed CLI in a clean Node image and smoke ht/--help/-V/init.
# Expected env:
#   TARBALL          path to harnesstap-*.tgz (inside the container)
#   SUPPORTED        true|false
#   EXPECT_INSTALL   true|false
#   CHECK_GYP        true|false (fail if npm install log contains "gyp")
set -euo pipefail

TARBALL="${TARBALL:?TARBALL is required}"
SUPPORTED="${SUPPORTED:?SUPPORTED is required}"
EXPECT_INSTALL="${EXPECT_INSTALL:-true}"
CHECK_GYP="${CHECK_GYP:-false}"

if [[ ! -f "$TARBALL" ]]; then
  echo "Tarball not found: $TARBALL" >&2
  exit 1
fi

# npx must extract the package into a writable directory. The CI mount of /pack is read-only.
work="$(mktemp -d)"
cp "$TARBALL" "$work/"
TARBALL="$(ls "$work"/harnesstap-*.tgz | head -n 1)"

echo "Node $(node -p 'process.versions.node') on $(command -v node)"
echo "npm $(npm -v)"

install_log="$(mktemp)"
set +e
npm install -g --omit=dev "$TARBALL" >"$install_log" 2>&1
install_code=$?
set -e
cat "$install_log"

if [[ "$CHECK_GYP" == "true" ]] && grep -Eiq 'gyp' "$install_log"; then
  echo "G1 failed: npm install log contains gyp (native compile should not run)" >&2
  exit 1
fi

if [[ "$install_code" -ne 0 ]]; then
  if [[ "$EXPECT_INSTALL" == "true" ]]; then
    echo "G1 failed: npm install -g exited $install_code" >&2
    exit 1
  fi
  echo "npm install -g failed as allowed for this image (EXPECT_INSTALL=$EXPECT_INSTALL)"
  exit 0
fi

if [[ "$EXPECT_INSTALL" != "true" ]]; then
  echo "npm install -g succeeded unexpectedly while EXPECT_INSTALL=false; continuing with CLI smoke"
fi

HOME_DIR="$(mktemp -d)"
export HOME="$HOME_DIR"
mkdir -p "$HOME_DIR"

run_cli() {
  local label="$1"
  shift
  local out err code
  out="$(mktemp)"
  err="$(mktemp)"
  set +e
  env HOME="$HOME_DIR" "$@" >"$out" 2>"$err"
  code=$?
  set -e
  echo "--- $label (exit $code) ---"
  echo "stdout:"
  cat "$out"
  echo "stderr:"
  cat "$err"
  if grep -q "ExperimentalWarning" "$err" || grep -q "ExperimentalWarning" "$out"; then
    echo "G1 failed: ExperimentalWarning in $label output" >&2
    exit 1
  fi
  if [[ "$SUPPORTED" == "true" ]]; then
    if [[ "$code" -ne 0 ]]; then
      echo "G1 failed: $label exited $code on supported Node" >&2
      exit 1
    fi
    if [[ ! -s "$out" ]]; then
      echo "G1 failed: $label produced empty stdout on supported Node" >&2
      exit 1
    fi
  else
    if [[ "$code" -eq 0 ]]; then
      echo "G1 failed: $label exited 0 on unsupported Node (silent no-op regression)" >&2
      exit 1
    fi
    if ! grep -q "needs Node.js" "$err" && ! grep -q "needs Node.js" "$out"; then
      echo "G1 failed: $label did not print the Node version guard message" >&2
      exit 1
    fi
  fi
}

run_cli "ht --help" ht --help
run_cli "ht -V" ht -V
run_cli "ht init --no-interactive" ht init --no-interactive

npx_home="$(mktemp -d)"
run_cli "npx --help" env HOME="$npx_home" npx --yes --package "$TARBALL" -- ht --help
run_cli "npx -V" env HOME="$npx_home" npx --yes --package "$TARBALL" -- ht -V

echo "G1 smoke passed for Node $(node -p 'process.versions.node') (supported=$SUPPORTED)"
