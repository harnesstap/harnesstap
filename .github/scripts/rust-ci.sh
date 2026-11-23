#!/usr/bin/env bash
# Helpers for .github/workflows/rust-ci.yml: discover crates under rust/
# and run cargo fmt, clippy and test, or the front-door replay.
#
# Replay uses the published rust-anything 3.3.0 from crates.io (see the
# workflow). It does not go through record/gate/map, so it does not need
# the local with_local_imports patch.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

if [ -d rust ]; then
  export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$root/rust/target}"
fi

list_crates() {
  if [ ! -d rust ]; then
    return 0
  fi
  find rust -name Cargo.toml -not -path '*/target/*' | LC_ALL=C sort
}

has_crates() {
  [ -n "$(list_crates)" ]
}

has_front_door() {
  [ -f rust/app/Cargo.toml ] && [ -d rust/app-cases ] && [ -f rust/run-sandboxed.sh ]
}

# rust-anything crates currently declare rust-version 1.97 while ADR-013
# sets MSRV to 1.90. The code builds on 1.90; this flag ignores the
# metadata so CI can use the MSRV toolchain. Drop it once those crates
# declare rust-version = "1.90".
IGNORE_MSRV=(--ignore-rust-version)

run_fmt() {
  if ! has_crates; then
    echo "No Cargo.toml files under rust/; skipping fmt."
    return 0
  fi
  local manifest failed=0
  while IFS= read -r manifest; do
    echo "::group::cargo fmt --check --manifest-path ${manifest}"
    if ! cargo fmt --all --check --manifest-path "${manifest}"; then
      echo "::error::cargo fmt --check failed for ${manifest}"
      failed=1
    fi
    echo "::endgroup::"
  done < <(list_crates)
  return "${failed}"
}

run_clippy() {
  if ! has_crates; then
    echo "No Cargo.toml files under rust/; skipping clippy."
    return 0
  fi
  local manifest failed=0
  while IFS= read -r manifest; do
    echo "::group::cargo clippy --manifest-path ${manifest}"
    if ! cargo clippy --manifest-path "${manifest}" --all-targets --locked "${IGNORE_MSRV[@]}" -- -D warnings; then
      echo "::error::cargo clippy failed for ${manifest}"
      failed=1
    fi
    echo "::endgroup::"
  done < <(list_crates)
  return "${failed}"
}

run_test() {
  if ! has_crates; then
    echo "No Cargo.toml files under rust/; skipping test."
    return 0
  fi
  local manifest failed=0
  while IFS= read -r manifest; do
    echo "::group::cargo test --manifest-path ${manifest}"
    if ! cargo test --manifest-path "${manifest}" --locked "${IGNORE_MSRV[@]}"; then
      echo "::error::cargo test failed for ${manifest}"
      failed=1
    fi
    echo "::endgroup::"
  done < <(list_crates)
  return "${failed}"
}

run_replay() {
  if ! has_front_door; then
    echo "Front door, app-cases or run-sandboxed.sh missing; skipping replay."
    return 0
  fi
  for tool in bun node cargo rust-anything; do
    if ! command -v "${tool}" >/dev/null 2>&1; then
      echo "::error::replay needs ${tool} on PATH"
      return 1
    fi
  done

  echo "::group::HT_RELEASE=1 bun run build"
  HT_RELEASE=1 bun run build
  echo "::endgroup::"

  if [ -f src/generated/scenarios.ts ]; then
    git checkout -- src/generated/scenarios.ts
  fi

  echo "::group::HT_RELEASE=1 cargo build --manifest-path rust/app/Cargo.toml"
  HT_RELEASE=1 cargo build --manifest-path rust/app/Cargo.toml --locked "${IGNORE_MSRV[@]}"
  echo "::endgroup::"

  local bin="${CARGO_TARGET_DIR}/debug/ht"
  if [ ! -x "${bin}" ]; then
    echo "::error::front-door binary not found at ${bin}"
    return 1
  fi

  echo "::group::rust-anything app replay"
  echo "node $(node --version), rust-anything $(rust-anything --version 2>/dev/null || true)"
  if rust-anything app replay . --timeout 30 --build "bash rust/run-sandboxed.sh ${bin}"; then
    echo "::endgroup::"
    return 0
  fi
  echo "::endgroup::"
  # Print the start of the report so a mismatch is visible in the job log.
  if [ -f rust/app-cases/replay-report.md ]; then
    echo "::group::replay-report.md (first 200 lines)"
    sed -n '1,200p' rust/app-cases/replay-report.md
    echo "::endgroup::"
  fi
  return 1
}

usage() {
  echo "usage: $0 fmt|clippy|test|replay|has-crates|has-front-door" >&2
  exit 2
}

case "${1:-}" in
  fmt) run_fmt ;;
  clippy) run_clippy ;;
  test) run_test ;;
  replay) run_replay ;;
  has-crates)
    if has_crates; then echo true; else echo false; exit 1; fi
    ;;
  has-front-door)
    if has_front_door; then echo true; else echo false; exit 1; fi
    ;;
  *) usage ;;
esac
