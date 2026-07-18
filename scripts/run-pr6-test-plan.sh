#!/usr/bin/env bash
# Manual PR test plan runner (PR #6). Uses fixtures; isolated HARNESSTAP_HOME.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI=(bun "$ROOT/dist/index.js")
FIXTURE_PROJECT="$ROOT/test/fixtures/claude-plugins-project"
FIXTURE_HOME="$ROOT/test/fixtures/claude-plugins-home"

HD_HOME="$(mktemp -d "${TMPDIR:-/tmp}/hd-test-plan-XXXX")"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/hd-test-project-XXXX")"
export HARNESSTAP_HOME="$HD_HOME"
export HOME="$FIXTURE_HOME"

cleanup() {
  rm -rf "$HD_HOME" "$WORKDIR"
}
trap cleanup EXIT

pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

cp -a "$FIXTURE_PROJECT/." "$WORKDIR/"
cd "$WORKDIR"
git init -q
git config user.email "test@example.com"
git config user.name "Test"
git remote add origin "git@github.com:acme/harnesstap-test-plan.git"
git add -A
git commit -q -m "init"

echo "=== 1. init + scan (plugin counts) ==="
"${CLI[@]}" init >/dev/null
SCAN_OUT="$("${CLI[@]}" scan . 2>&1)"
echo "$SCAN_OUT"
echo "$SCAN_OUT" | grep -qiE 'plugins \(claude-code\):.*committed.*effective' || fail "scan output missing plugin counts"
pass "scan shows committed/effective plugin counts"

echo "=== 2. plugin list --format json ==="
LIST_JSON="$("${CLI[@]}" plugin list . --format json)"
echo "$LIST_JSON" | bun -e '
const d = JSON.parse(await Bun.stdin.text());
if (!Array.isArray(d.committed) || !Array.isArray(d.effective)) throw new Error("missing arrays");
if (d.committed.length !== 2) throw new Error(`committed=${d.committed.length}`);
if (d.effective.length !== 3) throw new Error(`effective=${d.effective.length}`);
const f = d.effective.find((p) => p.ref === "formatter@acme-marketplace");
if (!f || f.enabled !== false || f.scope !== "local") throw new Error("local override missing");
console.log("ok committed/effective + local override");
' || fail "plugin list json"
pass "plugin list committed vs effective"

echo "=== 3. plugin installed / check / update --all ==="
INSTALLED_JSON="$("${CLI[@]}" plugin installed --platform claude-code --format json)"
echo "$INSTALLED_JSON" | bun -e '
const d = JSON.parse(await Bun.stdin.text());
if (!d.installs?.some((i) => i.ref === "demo@demo-market")) throw new Error("demo@demo-market missing");
console.log("ok installed");
' || fail "plugin installed"

set +e
CHECK_JSON="$("${CLI[@]}" plugin check --platform claude-code --format json 2>&1)"
CHECK_EXIT=$?
set -e
echo "$CHECK_JSON" | bun -e '
const d = JSON.parse(await Bun.stdin.text());
if (!(d.summary?.outdated > 0)) throw new Error("expected outdated plugins in fixture");
console.log("ok check outdated=", d.summary.outdated);
' || fail "plugin check"
if [[ "$CHECK_EXIT" -ne 1 ]]; then
  fail "plugin check should exit 1 when outdated (got $CHECK_EXIT)"
fi
pass "plugin check reports outdated (exit 1)"

set +e
UPDATE_JSON="$("${CLI[@]}" plugin update --all --platform claude-code --yes --format json 2>&1)"
set -e
echo "$UPDATE_JSON" | bun -e '
const d = JSON.parse(await Bun.stdin.text());
if (!d.summary || typeof d.summary.updated !== "number") throw new Error("bad update summary");
console.log("ok update summary", JSON.stringify(d.summary));
' || fail "plugin update --all"
pass "plugin update --all runs (summary returned)"

echo "=== 4. layer add-plugin + export/import round-trip ==="
"${CLI[@]}" layer create team-setup >/dev/null
"${CLI[@]}" layer add-plugin team-setup formatter@acme-marketplace --version ">=2.0.0 <3.0.0" >/dev/null
BUNDLE="$WORKDIR/team.harnesstap.toml"
"${CLI[@]}" migrate export "$BUNDLE" --layer team-setup >/dev/null
bun -e "
const { parse } = await import('smol-toml');
const raw = parse(await Bun.file(process.argv[1]).text());
if (raw.version !== 1 || raw.schema !== 'urn:harnesstap:layer:v1') throw new Error('expected layer v1');
const layer = raw.layers?.[0];
const pin = (layer?.plugins ?? []).find((p) => p.ref === 'formatter@acme-marketplace');
if (!pin || pin.version_constraint !== '>=2.0.0 <3.0.0') throw new Error('pin missing');
console.log('ok bundle pin');
" "$BUNDLE" || fail "export bundle"

HD_HOME2="$(mktemp -d "${TMPDIR:-/tmp}/hd-test-plan-import-XXXX")"
HARNESSTAP_HOME="$HD_HOME2" HOME="$FIXTURE_HOME" "${CLI[@]}" init >/dev/null
IMPORT_OUT="$(HARNESSTAP_HOME="$HD_HOME2" HOME="$FIXTURE_HOME" "${CLI[@]}" migrate import "$BUNDLE" 2>&1)"
echo "$IMPORT_OUT"
echo "$IMPORT_OUT" | grep -q 'team-setup' || fail "import layer"
rm -rf "$HD_HOME2"
pass "layer add-plugin + export/import round-trip"

echo "=== 5. project apply warn vs --strict-plugin-versions ==="
APPLY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hd-apply-XXXX")"
mkdir -p "$APPLY_DIR/.claude/plugins/CACHE/formatter/.claude-plugin"
echo '{"name":"formatter","version":"1.9.0"}' >"$APPLY_DIR/.claude/plugins/CACHE/formatter/.claude-plugin/plugin.json"
cat >"$APPLY_DIR/.claude/plugins/installed_plugins.json" <<'EOF'
{"version":2,"plugins":{"formatter@acme-marketplace":[{"scope":"project","installPath":"CACHE/formatter","version":"1.9.0"}]}}
EOF
echo '{"enabledPlugins":{"formatter@acme-marketplace":true}}' >"$APPLY_DIR/.claude/settings.json"
cd "$APPLY_DIR"
git init -q
git config user.email "test@example.com"
git config user.name "Test"
git remote add origin "git@github.com:acme/harnesstap-apply-test.git"
git add -A
git commit -q -m "init"

echo "# Ctx" >"$APPLY_DIR/CLAUDE.md"
HARNESSTAP_HOME="$HD_HOME" HOME="$FIXTURE_HOME" "${CLI[@]}" init >/dev/null
HARNESSTAP_HOME="$HD_HOME" HOME="$FIXTURE_HOME" "${CLI[@]}" scan "$APPLY_DIR" >/dev/null
HARNESSTAP_HOME="$HD_HOME" HOME="$FIXTURE_HOME" "${CLI[@]}" layer create mismatch-layer >/dev/null
HARNESSTAP_HOME="$HD_HOME" HOME="$FIXTURE_HOME" "${CLI[@]}" layer add-plugin mismatch-layer formatter@acme-marketplace --version ">=2.1.0 <3.0.0" >/dev/null
RESOURCE_ID="$(HARNESSTAP_HOME="$HD_HOME" HOME="$FIXTURE_HOME" "${CLI[@]}" resource list 2>/dev/null | grep "claude-instructions" | awk "{print \$2}")"
[[ -n "$RESOURCE_ID" ]] || fail "claude-instructions resource id not found"
HARNESSTAP_HOME="$HD_HOME" HOME="$FIXTURE_HOME" "${CLI[@]}" layer add mismatch-layer "$RESOURCE_ID" >/dev/null

WARN_OUT="$(HARNESSTAP_HOME="$HD_HOME" HOME="$FIXTURE_HOME" "${CLI[@]}" project apply mismatch-layer --project "$APPLY_DIR" --platform claude-code 2>&1 || true)"
echo "$WARN_OUT"
echo "$WARN_OUT" | grep -q "Plugin version mismatch" || fail "apply warn stderr"
echo "$WARN_OUT" | grep -qE "requires >=2\.1\.0|effective is" || fail "apply warn shows version detail"
pass "project apply warns on mismatch (default)"

set +e
STRICT_OUT="$(HARNESSTAP_HOME="$HD_HOME" HOME="$FIXTURE_HOME" "${CLI[@]}" project apply mismatch-layer --project "$APPLY_DIR" --platform claude-code --strict-plugin-versions 2>&1)"
STRICT_EXIT=$?
set -e
STRICT_OUT="${STRICT_OUT}"$'\n'"EXIT:${STRICT_EXIT}"
echo "$STRICT_OUT"
echo "$STRICT_OUT" | grep -q "Plugin version mismatch" || fail "strict stderr"
echo "$STRICT_OUT" | grep -q "EXIT:2" || fail "strict should exit 2"
pass "project apply --strict-plugin-versions exits 2"

rm -rf "$APPLY_DIR"
echo ""
echo "All PR #6 test plan steps passed."
