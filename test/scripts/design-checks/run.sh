#!/usr/bin/env bash
# Runs each design lint against the fixtures and checks the exit codes and counts.
set -u
cd "$(dirname "$0")/../../.."
pass=0; fail=0
expect() { # name expected_exit expected_count cmd...
  local name=$1 want=$2 count=$3; shift 3
  local out; out=$("$@" --json 2>/dev/null); local code=$?
  local n; n=$(node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));const a=Array.isArray(r)?r:Object.values(r).flat();console.log(a.filter(x=>!x.level||x.level==="error").filter(x=>x.ok!==true).length)' <<<"$out")
  if [[ $code == "$want" && ( $count == "-" || $n == "$count" ) ]]; then echo "ok   $name (exit $code, $n)"; pass=$((pass+1));
  else echo "FAIL $name (exit $code want $want, count $n want $count)"; fail=$((fail+1)); fi
}
F=test/scripts/design-checks/fixtures
S=scripts
expect "hex lint finds 4 raw colors"        1 4 node $S/check-raw-hex.mjs --root $F --path src
expect "hex lint clean on tokens only"      0 0 node $S/check-raw-hex.mjs --root $F --path src/styles/tokens.css
expect "copy lint finds 4 banned chars"     1 4 node $S/check-copy-chars.mjs --root $F
expect "copy lint clean on good file"       0 0 node $S/check-copy-chars.mjs --root $F --path src/styles
expect "drift identical token copies"       0 0 node $S/check-token-drift.mjs --tokens design-tokens.json --snapshot design-tokens.json
expect "drift catches bad css"              1 5 node $S/check-token-drift.mjs --tokens design-tokens.json --css $F/tokens-bad.css
expect "contrast passes on repo tokens"     0 0 node $S/check-contrast.mjs --tokens design-tokens.json
node -e 'const fs=require("fs");const t=JSON.parse(fs.readFileSync("design-tokens.json"));t.themes.light.muted="#94A3B8";t.shared["brand-teal"]="#0F766E";fs.writeFileSync("/tmp/tokens-broken.json",JSON.stringify(t))'
expect "contrast fails on broken tokens"    1 - node $S/check-contrast.mjs --tokens /tmp/tokens-broken.json
node -e 'const fs=require("fs");const t=JSON.parse(fs.readFileSync("design-tokens.json"));t.shared["action-primary"]="#3B82F6";fs.writeFileSync("/tmp/tokens-drifted.json",JSON.stringify(t))'
expect "drift fails on changed hex"         1 1 node $S/check-token-drift.mjs --tokens design-tokens.json --snapshot /tmp/tokens-drifted.json
# Changed-lines mode: old debt is ignored, new hex on added lines fails.
G=$(mktemp -d)
( cd "$G" && git init -q && git config user.email t@t && git config user.name t && mkdir -p src \
  && printf 'export const Old = () => <div style={{ color: "#0f172a" }} />;\n' > src/Old.tsx \
  && printf '.legacy { color: #123456; }\n' > src/legacy.css \
  && git add -A && git commit -qm base && git branch -q base \
  && printf 'export const New = () => <div className="bg-[#ff0000]" />;\nexport const Ok = () => <div className="bg-surface" />;\n' > src/New.tsx \
  && printf '.legacy { color: #123456; }\n.fresh { border-color: #abcdef; }\n' > src/legacy.css \
  && git add -A && git commit -qm change )
expect "changed-lines: only 2 new hexes"    1 2 node $S/check-raw-hex.mjs --root "$G" --path src --changed-since base
expect "changed-lines: full scan finds 4"   1 4 node $S/check-raw-hex.mjs --root "$G" --path src
( cd "$G" && git checkout -q -b clean base && printf 'export const Ok = () => <div className="bg-surface" />;\n' > src/Ok.tsx && git add -A && git commit -qm clean )
expect "changed-lines: clean PR passes"     0 0 node $S/check-raw-hex.mjs --root "$G" --path src --changed-since base
out=$(node $S/check-raw-hex.mjs --root "$G" --path src --changed-since no-such-ref 2>&1); code=$?
if [[ $code == 2 ]]; then echo "ok   changed-lines: missing base ref exits 2"; pass=$((pass+1)); else echo "FAIL missing base ref exit $code"; fail=$((fail+1)); fi
rm -rf "$G"
echo "$pass passed, $fail failed"; [[ $fail == 0 ]]
