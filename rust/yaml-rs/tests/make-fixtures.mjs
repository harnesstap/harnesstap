// Records the `yaml` package's parse(source) (the app's copy) on a corpus, as fixtures for
// tests/fixtures.rs. Run from the repository root:
//   node rust/yaml-rs/tests/make-fixtures.mjs [path/to/yaml-test-suite]
// The yaml-test-suite checkout (tag data-2022-01-17) is optional; its inputs are copied into
// the fixture, so the test does not need it.
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const YAML = require("../../../node_modules/yaml");

const sources = [];
const add = (origin, src) => sources.push({ origin, src });

// 1. The yaml-test-suite inputs.
const suite = process.argv[2];
if (suite && existsSync(suite)) {
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "in.yaml") add(`suite:${p.slice(suite.length + 1)}`, readFileSync(p, "utf8"));
    }
  };
  walk(suite);
}

// 2. YAML files in the repository.
for (const p of ["apm.yml", ".changie.yaml", "test/fixtures/goose-project/recipes/security-audit.yaml"]) {
  add(`repo:${p}`, readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8"));
}

// 3. Hand-written scalars and structures.
const scalars = [
  "", "~", "null", "Null", "NULL", "nULL", "true", "True", "TRUE", "tRUE", "yes", "no", "on", "off", "y",
  "0", "-0", "+0", "007", "+12", "-12", "1_000", "0o17", "0o8", "0O17", "0x1F", "0xff", "0X1F", "0b101",
  "1.0", "1.", ".5", "-.5", "+.5", "1.50", "1e3", "1E3", "1e+3", "1.5e-3", ".5e2", "1.e2", "e3", "1e",
  ".inf", "-.inf", "+.Inf", ".NaN", ".nan", "inf", "NaN", "12345678901234567890", "9007199254740993",
  "0x1FFFFFFFFFFFFFF", "0o7777777777777777777777", "123456789012345678901234567890.5",
  "2001-12-14", "2001-12-14t21:59:43.10-05:00", "1:20", "<<", "=", "a b", "a  b", "'quoted'", "\"dq\"",
  "@at", "`tick", "%pct", "!bang", "&amp", "*star", "|pipe", ">gt", "-", "- x", "? q", ": c", "a: b",
  "a #c", "a#c", "#c", "[x]", "{x}", "x,y", "\\", "é", "日本", "😀", "\t", "a\tb",
];
for (const s of scalars) {
  add("scalar", `key: ${s}\n`);
  add("scalar", `- ${s}\n`);
  add("scalar", `${s}\n`);
  add("scalar", `key: '${s.replace(/'/g, "''")}'\n`);
  add("scalar", `key: ${JSON.stringify(s)}\n`);
  add("scalar", `${s}: value\n`);
  add("scalar", `{ ${s}: v }\n`);
}
const tags = ["!!str", "!!int", "!!float", "!!bool", "!!null", "!!map", "!!seq", "!", "!local", "!!binary", "!!timestamp", "!<tag:yaml.org,2002:str>"];
for (const t of tags) {
  for (const v of ["12", "1.5", "true", "abc", "", "~", "0x1F", "'12'", "\"1.5\"", "2001-12-14", "R0lG"]) {
    add("tag", `k: ${t} ${v}\n`);
  }
  add("tag", `k: ${t} [a, b]\n`);
  add("tag", `k: ${t} {a: b}\n`);
  add("tag", `k: ${t}\n  a: b\n`);
}
const structures = [
  "a: 1\na: 2\n", "1: a\n01: b\n", "1: a\n'1': b\n", "~: a\nnull: b\n", "true: a\nTrue: b\n",
  "0: a\n-0: b\n", "1.0: a\n1: b\n", "? [a, b]\n: c\n", "? {a: b}\n: c\n", "[a, b]: c\n",
  "__proto__: x\n", "constructor: x\n", "b: 1\na: 2\n2: x\n1: y\n", "10: a\n9: b\n-1: c\n01: d\n",
  "<<: {a: 1}\nb: 2\n", "base: &b {a: 1}\nderived:\n  <<: *b\n  c: 2\n",
  "a: &x 1\nb: *x\n", "a: &x [1, 2]\nb: *x\nc: *x\n", "a: *missing\n", "&a a: &b b\n*a : *b\n",
  "a: &x 1\na2: &x 2\nb: *x\n",
  "---\na: 1\n", "---\na: 1\n...\n", "---\na: 1\n---\nb: 2\n", "--- 1\n--- 2\n", "...\n", "---\n", "# only\n",
  "\n\n", "%YAML 1.2\n---\na: 1\n", "%YAML 1.1\n---\na: yes\n", "%TAG !e! tag:example.com,2000:\n---\na: !e!x 1\n",
  "a:\n  - 1\n  - 2\nb:\n  c: d\n", "- a\n- - b\n  - c\n- d: e\n  f: g\n", "a: [1, 2, {b: c}]\n",
  "{a: 1, b: [2, 3]}\n", "[a, b, ]\n", "{a, b: c}\n", "[a: b, c]\n", "a: |\n  line1\n  line2\n",
  "a: |-\n  x\n\n", "a: |+\n  x\n\n", "a: >\n  folded\n  text\n\n  para\n", "a: >-\n  x\n  y\n",
  "a: |2\n   indented\n", "a: >+\n  x\n\n\n", "a: |\n\n  after blank\n", "a: \"multi\n  line\"\n",
  "a: 'multi\n\n  line'\n", "a: plain\n  continued\n", "a: \"esc \\t \\n \\u00e9 \\x41 \\\\ \\\" \\/ \\0 \\e \\N \\_ \\L \\P\"\n",
  "a: \"\\U0001F600\"\n", "a: 'it''s'\n", "a: b # comment\n", "a: 'b' # c\n", "a:\tb\n", "a:\n\tb\n",
  "a: b\r\nc: d\r\n", "\ufeffa: b\n", "a: b\n\ufeff", "a: [\n  1,\n  2\n]\n", "a: {\n  b: 1\n}\n",
  "- &a\n  x: 1\n- *a\n", "a: @x\n", "a: `x\n", "a: b: c\n", "a:\n- b\n", "a:\n  - b\n c: d\n",
  "  a: 1\nb: 2\n", "a: 1\n  b: 2\n", "- a\nb: c\n", "a: [b\n", "a: {b\n", "a: \"b\n", "a: 'b\n",
  "key with spaces: v\n", "\"quoted key\": v\n", "'single': v\n", "? complex\n: v\n", "?\n: v\n", ": v\n",
  "a: !!str\nb: !!null\n", "a: -\n", "a: - b\n", "- - - x\n", "-\n-\n", "a:\nb:\n", "a: ~\nb:\n",
  "x: 2001-12-14\n", "x: 12:30:45\n", "x: 1,000\n", "x: $1\n", "x: 50%\n", "x: http://a.b/c?d=e#f\n",
  "x: a:b\n", "x: 'a: b'\n", "x: [a:b]\n", "x: {a:b}\n", "x: {a: b}c\n", "x: !!int '0x1F'\n",
  "x: 0x_1F\n", "x: 1__0\n", "x: +.5\n", "x: -.\n", "x: .\n", "x: +\n", "x: -1e-1\n",
  "a:\t-1\n", "a:\t\tb\n", "a: \tb\n", "- a:\tb\n", "{a:\tb}\n", "a:\t|\n  x\n", "a:\t\"q\"\n", "a: \"x:\ty\"\n",
  "a:\tb\nc:\td\n", "a:\t# c\n  b\n", "x:\n  a:\tb\n", "a:\tb:\tc\n", "a:\t[b]\n", "'k':\tv\n",
  "lockfile_version: 1\ngenerated_at: '2026-01-01T00:00:00.000Z'\ndependencies:\n  - name: dep\n    version: 1.2.3\n    source_kind: marketplace\n    resolved_ref: abc\n",
];
for (const s of structures) add("structure", s);

// 4. Round trips of generated values through the stringify calls the app makes.
let seed = 0x9a11;
const rnd = (n) => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) % n;
};
const pick = (a) => a[rnd(a.length)];
const strs = [...scalars, "multi\nline", "trailing\n", "\nleading", "  spaced  ", "a: b\nc", "#x", "x #y", "---", "...", "- a", "line1\n\nline3", "tab\there", "\u2028", "q'q\"q", "long ".repeat(30)];
const value = (depth) => {
  const r = rnd(depth > 3 ? 4 : 7);
  if (r === 0) return pick(strs);
  if (r === 1) return pick([0, 1, -1, 1.5, -0.25, 1e21, 1e-7, 123456789, 2 ** 53 + 2, null, true, false]);
  if (r === 2 || r === 3) return pick(strs);
  if (r === 4 || r === 5) {
    const o = {};
    for (let i = 0, n = rnd(4); i < n; i++) o[rnd(5) === 0 ? String(rnd(20)) : pick(strs)] = value(depth + 1);
    return o;
  }
  return Array.from({ length: rnd(4) }, () => value(depth + 1));
};
for (let i = 0; i < 400; i++) {
  const v = value(0);
  add("roundtrip-app", YAML.stringify(v, { indent: 2, lineWidth: 0, defaultKeyType: "PLAIN" }));
  add("roundtrip-default", YAML.stringify(v));
  if (rnd(3) === 0) add("roundtrip-flow", JSON.stringify(v));
}

const cases = [];
const seen = new Set();
for (const { origin, src } of sources) {
  if (seen.has(src)) continue;
  seen.add(src);
  const warn = process.emitWarning;
  process.emitWarning = () => {};
  try {
    const v = YAML.parse(src);
    cases.push({ origin, src, json: JSON.stringify(v === undefined ? null : v) ?? "null" });
  } catch (e) {
    cases.push({ origin, src, err: { name: e.name, code: e.code ?? null } });
  } finally {
    process.emitWarning = warn;
  }
}
writeFileSync(new URL("./fixtures/parse.json", import.meta.url), JSON.stringify(cases));
console.log(cases.length, "cases,", cases.filter((c) => c.err).length, "errors");
