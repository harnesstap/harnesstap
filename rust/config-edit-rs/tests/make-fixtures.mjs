// Records src/services/format-preserving-config.ts for tests/fixtures.rs: parseJsonObject,
// overlayJsonPreservingFormat, applyJsonObjectUpdatePreservingFormat, smol-toml parse and
// stringify, overlayTomlPreservingFormat and applyTomlObjectUpdatePreservingFormat, on
// generated and hand-written JSONC and TOML files. Run from the repo root under Node:
//   node --experimental-transform-types --import ./rust/apm-rs/tests/ts-resolve.mjs rust/config-edit-rs/tests/make-fixtures.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import * as f from "../../../src/services/format-preserving-config.ts";

let seed = 0xc0f1e;
function rand() {
  seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0;
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 0x297a2d39);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const int = (n) => Math.floor(rand() * n);
const chance = (p) => rand() < p;

const DATE_KEY = "\u0000toml-date";
// JSON for the Rust side: a TOML date becomes { "\0toml-date": toISOString() }.
function enc(v) {
  if (v instanceof Date) return { [DATE_KEY]: v.toISOString() };
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).map((k) => [k, enc(v[k])]));
  return v;
}
function run(fn) {
  try {
    return { ok: fn() };
  } catch (e) {
    return { err: String(e.message) };
  }
}

// ---- JSON ----
const KEYS = ["mcpServers", "hooks", "env", "permissions", "enabledPlugins", "a", "b", "name", "command", "args", "10", "2", "0", "$schema", "é", "😀k", "type", "url", "x y", "toString"];
const SUBKEYS = ["github", "fs", "PreToolUse", "Stop", "allow", "deny", "PATH", "TOKEN", "a", "b", "1", "z", "ünï"];
const STRS = ["", "x", "npx", "with \"quote\"", "back\\slash", "tab\there", "line\nbreak", "é😀", "$1 and $&", "${HOME}/bin", "/usr/bin/env", "// not a comment", "/* nor this */", "a,b", "}{"];
const NUMS = [0, 1, -1, 1.5, 100, 1e21, 0.1, -2.5e-7, 12345678];
function jsonValue(depth) {
  const k = int(depth > 2 ? 3 : 6);
  if (k === 0) return pick(NUMS);
  if (k === 1) return pick(STRS);
  if (k === 2) return pick([true, false, null]);
  if (k === 3) return Array.from({ length: int(4) }, () => jsonValue(depth + 1));
  return jsonObject(depth + 1, depth === 0 ? KEYS : SUBKEYS);
}
function jsonObject(depth, keys = KEYS) {
  const o = {};
  for (let i = int(depth === 0 ? 7 : 4); i > 0; i--) o[pick(keys)] = jsonValue(depth);
  return o;
}
function comment(eol) {
  return pick([`// note${eol}`, "/* c */ ", `/* multi${eol}line */ `, `// ${pick(STRS).replace(/\n/g, " ")}${eol}`]);
}
// Renders a value with a random but consistent layout.
function render(value, st, level = 0) {
  const pad = (n) => (st.oneLine ? "" : st.unit.repeat(n));
  const nl = st.oneLine ? (st.spaced ? " " : "") : st.eol;
  const c = () => (chance(st.comments) ? (st.oneLine ? "/* c */ " : `${pad(level + 1)}${comment(st.eol)}`) : "");
  if (Array.isArray(value)) {
    if (value.length === 0) return chance(0.5) ? "[]" : `[${nl}${pad(level)}]`;
    const items = value.map((v) => `${c()}${pad(level + 1)}${render(v, st, level + 1)}`);
    return `[${nl}${items.join(`,${nl}`)}${chance(st.trailing) ? "," : ""}${nl}${pad(level)}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return pick(["{}", "{ }", `{${nl}${pad(level)}}`]);
    const sep = st.colon;
    const items = keys.map((k) => `${c()}${pad(level + 1)}${JSON.stringify(k)}${sep}${render(value[k], st, level + 1)}${chance(st.comments / 3) ? " // tail" + st.eol + pad(level + 1) : ""}`);
    return `{${nl}${items.join(`,${nl}`)}${chance(st.trailing) ? "," : ""}${nl}${pad(level)}}`;
  }
  return JSON.stringify(value);
}
function style() {
  return {
    unit: pick(["  ", "  ", "    ", "\t", " ", "        ", "   "]),
    eol: chance(0.2) ? "\r\n" : "\n",
    oneLine: chance(0.12),
    spaced: chance(0.5),
    comments: pick([0, 0, 0.1, 0.3]),
    trailing: pick([0, 0, 0.3]),
    colon: pick([": ", ": ", ":", " : "]),
  };
}
function jsonText(value) {
  const st = style();
  let text = `${chance(0.1) ? comment(st.eol) : ""}${render(value, st)}`;
  if (chance(0.75)) text += st.eol;
  if (chance(0.05)) text += `// trailing${st.eol}`;
  return text;
}
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function mutate(value, depth = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return chance(0.5) ? jsonValue(depth + 1) : value;
  const o = clone(value);
  for (const k of Object.keys(o)) {
    const r = rand();
    if (r < 0.2) delete o[k];
    else if (r < 0.4) o[k] = mutate(o[k], depth + 1);
    else if (r < 0.5) o[k] = jsonValue(depth + 1);
  }
  for (let i = int(3); i > 0; i--) o[pick(depth === 0 ? KEYS : SUBKEYS)] = jsonValue(depth + 1);
  return o;
}
function overlayFor(existing) {
  const o = {};
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  for (const k of Object.keys(base)) {
    if (chance(0.3)) o[k] = chance(0.5) ? clone(base[k]) : mutate(base[k], 1);
  }
  for (let i = int(3); i > 0; i--) {
    const k = pick(KEYS);
    o[k] = chance(0.5) ? jsonObject(1, SUBKEYS) : jsonValue(1);
  }
  return o;
}

const handJson = [
  "", " ", "\n", "{}", "{}\n", "{ }", "[]", "[1]", "1", "\"x\"", "null", "{", "}", "{\"a\": 1,}", "{\"a\": 1,,}", "{\"a\" 1}", "{\"a\": }", "{,}", "{\"a\": 1} x",
  "{\"a\": 01}", "{\"a\": 1.}", "{\"a\": -}", "{\"a\": .5}", "{\"a\": 1e}", "{\"a\": \"\\x\"}", "{\"a\": \"\\u12\"}", "{\"a\": \"line\nbreak\"}", "{\"a\": \"tab\tin\"}", "{a: 1}", "{'a': 1}",
  "{\"a\": 1 /* unclosed", "// only a comment\n", "/* c */ {\"a\": 1}", "{\"a\": 1}\n// end\n", "{\"a\": TRUE}", "{\"a\": NaN}", "{\"a\": 1e400}", "{\"a\": -0}", "{\"a\": 1E+2, \"b\": 2e-2}",
  "\uFEFF{\"a\": 1}", "{\"a\": 1, \"a\": 2}", "{\"a\": {\"x\": 1}, \"a\": {\"y\": 2}}", "{\"__proto__\": 1, \"b\": 2}", "{\"b\": 1, \"2\": 2, \"a\": 3, \"1\": 4}",
  "{\n  \"mcpServers\": {\n    // keep me\n    \"github\": { \"command\": \"npx\" }\n  }\n}\n",
  "{\r\n\t\"hooks\": {\r\n\t\t\"Stop\": []\r\n\t}\r\n}",
  "{\n    \"env\": {\n        \"A\": \"1\"\n    },\n    /* block */\n    \"permissions\": { \"allow\": [\"x\"] }\n}",
  "{\"a\":1,\"b\":{\"c\":[1,2,{\"d\":null}]}}",
  "{\n  \"a\": 1, // first\n  \"b\": 2 /* second */\n}\n",
  "{\n  \"a\": 1\n  ,\"b\": 2\n}\n",
  "{\n\n  \"a\": 1,\n\n\n  \"b\": 2\n\n}\n",
  "{\r\"a\": 1\r}\r",
  `{\n${" ".repeat(50)}"a": {"b": {"c": {"d": 1}}}\n}\n`,
  `{\n${" ".repeat(50)}"a": 1\n}\n`,
  "{\n  \"\\u0041\": 1, \"\\ud83d\\ude00\": 2\n}\n",
];

const jsonCases = [];
function addJson(raw, rng = true) {
  const parsed = f.parseJsonObject(raw);
  jsonCases.push({ fn: "parse", raw, out: parsed });
  const existing = parsed ?? {};
  const mergeKeys = [...new Set(Array.from({ length: int(3) }, () => pick(["mcpServers", "hooks", "env", "a", "permissions"])))];
  const opts = { mergeObjectKeys: mergeKeys, onUnparseable: pick(["replace", "keep", undefined]) };
  for (let i = rng ? 2 : 3; i > 0; i--) {
    const overlay = overlayFor(existing);
    jsonCases.push({ fn: "overlay", raw, overlay, opts, out: run(() => f.overlayJsonPreservingFormat(raw, overlay, opts)) });
  }
  for (let i = 2; i > 0; i--) {
    const next = mutate(existing);
    jsonCases.push({ fn: "update", raw, next, out: run(() => f.applyJsonObjectUpdatePreservingFormat(raw, next)) });
  }
}
for (const raw of handJson) addJson(raw, false);
for (let i = 0; i < 700; i++) addJson(jsonText(jsonObject(0)));
// Missing files, and overlays with keys JavaScript treats specially.
for (const raw of [null, undefined, ""]) {
  const overlay = jsonObject(0);
  jsonCases.push({ fn: "overlay", raw, overlay, opts: {}, out: run(() => f.overlayJsonPreservingFormat(raw, overlay)) });
}
for (const text of ['{"__proto__": {"x": 1}, "a": 1}', '{"mcpServers": {"__proto__": 1}}', '{"constructor": 1}', '{"toString": {"a": 1}}']) {
  const overlay = JSON.parse(text);
  for (const raw of ['{\n  "a": 0\n}\n', '{\n  "mcpServers": {"x": 1},\n  "toString": 2\n}\n']) {
    const opts = { mergeObjectKeys: ["mcpServers", "toString"] };
    jsonCases.push({ fn: "overlay", raw, overlay, opts, out: run(() => f.overlayJsonPreservingFormat(raw, overlay, opts)) });
    jsonCases.push({ fn: "update", raw, next: overlay, out: run(() => f.applyJsonObjectUpdatePreservingFormat(raw, overlay)) });
  }
}

// Duplicate keys: the edit lands on the first property, which may not be an object.
for (const raw of ['{"a": 1, "a": {"x": 1}}', '{\n  "a": [],\n  "a": {"x": 1}\n}\n', '{"a": {"x": 1}, "a": {"y": 2}}']) {
  for (const overlay of [{ a: { y: 2 } }, { a: { x: 3 } }, { a: 5 }]) {
    const opts = { mergeObjectKeys: ["a"] };
    jsonCases.push({ fn: "overlay", raw, overlay, opts, out: run(() => f.overlayJsonPreservingFormat(raw, overlay, opts)) });
  }
}

// ---- TOML ----
const TKEYS = ["model", "model_provider", "approval_policy", "mcp_servers", "permissions", "shell_environment_policy", "profiles", "plugins", "features", "a", "b", "x-y", "under_score", "has space", "é", "1", "07", "toString"];
const TSUB = ["github", "fs", "command", "args", "env", "enabled", "source", "set", "inherit", "url", "timeout", "a.b", "PATH", "TOKEN", "2"];
const TSTR = ["", "x", "npx", "gpt-5", "with \"quote\"", "back\\slash", "tab\there", "é😀", "$1 and $&", "${HOME}/bin", "a = b", "# not a comment", "[not.a.table]", "{ brace }", "del\x7fete", "line\nbreak"];
const TNUM = [0, 1, -1, 1.5, 100, 0.1, -2.5e-7, 12345678, 30, 1e21];
function tomlValue(depth, top) {
  const k = int(depth > 2 ? 3 : top ? 5 : 6);
  if (k === 0) return pick(TNUM);
  if (k === 1) return pick(TSTR);
  if (k === 2) return pick([true, false]);
  if (k === 3) return Array.from({ length: int(4) }, () => (chance(0.7) ? pick(TSTR) : pick(TNUM)));
  if (k === 4) return tomlObject(depth + 1);
  return Array.from({ length: 1 + int(2) }, () => tomlObject(depth + 1));
}
function tomlObject(depth, keys = depth === 0 ? TKEYS : TSUB) {
  const o = {};
  for (let i = int(depth === 0 ? 7 : 4); i > 0; i--) o[pick(keys)] = tomlValue(depth, depth === 0);
  return o;
}
function decorate(text) {
  const lines = text.split("\n");
  const out = [];
  for (const line of lines) {
    if (chance(0.08)) out.push(pick(["# comment", "", "  # indented comment", "#[not.a.table]"]));
    if (line && !line.startsWith("[") && chance(0.1)) out.push(`${line} # trailing`);
    else if (line && !line.startsWith("[") && chance(0.08)) out.push(`  ${line}`);
    else out.push(line);
  }
  let t = out.join("\n");
  if (chance(0.15)) t = t.replace(/\n+$/, "");
  if (chance(0.05)) t = t.replace(/\n/g, "\r\n");
  return t;
}
const handToml = [
  "", "   \n", "# only a comment\n", "model = \"gpt-5\"\n", "model = \"gpt-5\"", "model = 'single'\n", "model = \"\"\"multi\nline\"\"\"\n",
  "a = 1\n[mcp_servers.github]\ncommand = \"npx\"\nargs = [\"-y\", \"server\"]\n\n[mcp_servers.github.env]\nTOKEN = \"x\"\n",
  "[mcp_servers]\ngithub = { command = \"npx\", args = [] }\n",
  "[permissions]\nallow = [\"a\"]\n\n[shell_environment_policy]\ninherit = \"core\"\n\n[shell_environment_policy.set]\nPATH = \"/bin\"\n",
  "model = \"o3\" # trailing\n\n[profiles.fast]\nmodel = \"gpt\"\n",
  "  [indented]\n  key = 1\n",
  "[a]\nb.c = 1\nb.d = 2\n", "a.b.c = 1\n", "\"quoted key\" = 1\n[\"table x\".y]\nz = true\n",
  "[[plugins]]\nname = \"a\"\n[[plugins]]\nname = \"b\"\n",
  "d1 = 1979-05-27T07:32:00Z\nd2 = 1979-05-27T00:32:00.999999-07:00\nd3 = 1979-05-27T07:32:00\nd4 = 1979-05-27\nd5 = 07:32:00\nd6 = 1979-05-27 07:32:00Z\n",
  "[t]\nwhen = 2024-01-01\n", "x = 0x1F\ny = 0o17\nz = 0b101\nw = 1_000\nv = +3\nu = -0\nf = 6.02e23\ng = -0.0\n",
  "big = 9007199254740993\n", "big = 9007199254740991\n", "a = 1\na = 2\n", "[a]\n[a]\n", "a = \n", "a = [1, \"x\"]\n", "= 1\n", "a = 1 b = 2\n", "[a\n",
  "b = 1\n2 = 2\na = 3\n1 = 4\n", "__proto__ = 1\nb = 2\n", "[t]\n__proto__ = 1\n", "toString = 1\n",
  "model = \"x\"\r\n[mcp_servers.a]\r\ncommand = \"c\"\r\n", "a = \"\\u00e9\\t\\\"\"\n", "a = { b = { c = 1 } }\n", "a = []\nb = [[1], [2]]\nc = [{x = 1}]\n",
  "[mcp_servers.github]\ncommand = \"npx\"\n[mcp_servers.github.env]\nA = \"1\"\n[mcp_servers.other]\ncommand = \"x\"\n[model_providers.p]\nname = \"p\"\n",
];
function shallow(existing, overlay) {
  return { ...existing, ...overlay };
}
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function codexMerge(existing, overlay) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(overlay)) {
    if (key === "permissions" && isRecord(value) && isRecord(merged.permissions)) {
      merged.permissions = { ...merged.permissions, ...value };
      continue;
    }
    if (key === "shell_environment_policy" && isRecord(value) && isRecord(merged.shell_environment_policy)) {
      const existingPolicy = merged.shell_environment_policy;
      const existingSet = isRecord(existingPolicy.set) ? existingPolicy.set : {};
      const overlaySet = isRecord(value.set) ? value.set : {};
      merged.shell_environment_policy = { ...existingPolicy, ...value, set: { ...existingSet, ...overlaySet } };
      continue;
    }
    merged[key] = value;
  }
  return merged;
}
const MERGES = { shallow, codex: codexMerge };
function tomlMutate(value, depth = 0) {
  if (!isRecord(value)) return chance(0.5) ? tomlValue(depth + 1) : value;
  const o = { ...value };
  for (const k of Object.keys(o)) {
    const r = rand();
    if (r < 0.2) delete o[k];
    else if (r < 0.45) o[k] = tomlMutate(o[k], depth + 1);
    else if (r < 0.55) o[k] = tomlValue(depth + 1);
  }
  for (let i = int(3); i > 0; i--) o[pick(depth === 0 ? TKEYS : TSUB)] = tomlValue(depth + 1, depth === 0);
  return o;
}
function tomlOverlay(existing) {
  const o = {};
  for (const k of Object.keys(existing)) if (chance(0.3)) o[k] = chance(0.4) ? existing[k] : tomlMutate(existing[k], 1);
  if (chance(0.6)) o.mcp_servers = { [pick(TSUB)]: { command: pick(TSTR), args: [pick(TSTR)], ...(chance(0.4) ? { env: { [pick(TSUB)]: pick(TSTR) } } : {}) } };
  if (chance(0.3)) o.permissions = { [pick(TSUB)]: tomlValue(2) };
  if (chance(0.3)) o.shell_environment_policy = { set: { [pick(TSUB)]: pick(TSTR) } };
  if (chance(0.4)) o.model = pick(TSTR);
  if (chance(0.2)) o.model_provider = pick(TSTR);
  return o;
}

const tomlCases = [];
function addToml(raw) {
  let parsed;
  try {
    parsed = parseToml(raw);
    tomlCases.push({ fn: "parse", raw, out: { ok: enc(parsed) } });
  } catch {
    tomlCases.push({ fn: "parse", raw, out: { err: true } });
  }
  const existing = parsed ?? {};
  for (let i = 2; i > 0; i--) {
    const overlay = tomlOverlay(existing);
    const merge = pick(Object.keys(MERGES));
    tomlCases.push({ fn: "overlay", raw, overlay: enc(overlay), merge, out: run(() => f.overlayTomlPreservingFormat(raw, overlay, MERGES[merge])) });
  }
  for (let i = 2; i > 0; i--) {
    const next = tomlMutate(existing);
    tomlCases.push({ fn: "update", raw, next: enc(next), out: run(() => f.applyTomlObjectUpdatePreservingFormat(raw, next)) });
  }
}
for (const raw of handToml) addToml(raw);
for (let i = 0; i < 700; i++) addToml(decorate(stringifyToml(tomlObject(0))));
for (const raw of [null, undefined]) {
  const overlay = tomlObject(0);
  tomlCases.push({ fn: "overlay", raw, overlay, merge: "shallow", out: run(() => f.overlayTomlPreservingFormat(raw, overlay, shallow)) });
}
// stringify on its own, including the values it refuses.
const stringifyInputs = [{}, { a: null }, { a: [null] }, { a: [1, null] }, { a: { b: null } }, { a: [{}, {}] }, { a: [{ b: 1 }, 2] }, { "": 1 }, { a: { "": { b: 1 } } }, { a: "\x7f" }, { a: {} }, { a: { b: {} } }];
for (let i = 0; i < 300; i++) stringifyInputs.push(tomlObject(0));
for (const value of stringifyInputs) tomlCases.push({ fn: "stringify", value, out: run(() => stringifyToml(value)) });

mkdirSync(new URL("./fixtures/", import.meta.url), { recursive: true });
writeFileSync(new URL("./fixtures/format-preserving-config.json", import.meta.url), `${JSON.stringify({ json: jsonCases, toml: tomlCases })}\n`);
console.log(`json ${jsonCases.length}, toml ${tomlCases.length}`);
