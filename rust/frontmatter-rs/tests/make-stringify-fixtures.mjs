// Records gray-matter 4.0.3 `matter.stringify` (js-yaml 3.14.2 `safeDump`) output for
// tests/stringify.rs. Run from the repo root under Node with TZ=UTC:
//   TZ=UTC node rust/frontmatter-rs/tests/make-stringify-fixtures.mjs
import { readFileSync, writeFileSync, readdirSync, lstatSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const matter = require("gray-matter");
const jsyaml = require("js-yaml");
if (!/^3\./.test(require("js-yaml/package.json").version)) throw new Error("expected js-yaml 3 at the repo root");
if (require("gray-matter/package.json").version !== "4.0.3") throw new Error("expected gray-matter 4.0.3");
if (process.env.TZ !== "UTC") throw new Error("run with TZ=UTC");

let seed = 0x5713a6f1;
// mulberry32
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const int = (n) => Math.floor(rand() * n);

class Skip extends Error {}

// A deep copy, so no input shares an object (a JsValue is a tree; shared objects would make
// js-yaml write `&ref_N` anchors).
function cl(v) {
  if (v instanceof Date) return new Date(v.getTime());
  if (Buffer.isBuffer(v)) return Buffer.from(v);
  if (Array.isArray(v)) return v.map(cl);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) Object.defineProperty(o, k, { value: cl(v[k]), enumerable: true, writable: true, configurable: true });
    return o;
  }
  return v;
}

// Same encoding as make-fixtures.mjs; inputs must be representable exactly, and a tree.
function enc(v, seen = new Set()) {
  if (v === undefined) return { $undef: true };
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") return { $num: Object.is(v, -0) ? "-0" : String(v) };
  if (typeof v === "string") {
    if (!v.isWellFormed()) throw new Skip("lone surrogate");
    return v;
  }
  if (seen.has(v)) throw new Skip("shared object");
  seen.add(v);
  {
    if (v instanceof Date) return { $date: String(v.getTime()) };
    if (Buffer.isBuffer(v)) return { $buf: [...v] };
    if (Array.isArray(v)) return v.map((x) => enc(x, seen));
    if (Object.getPrototypeOf(v) !== Object.prototype) throw new Skip("exotic object");
    return { $obj: Object.keys(v).map((k) => [enc(k), enc(v[k], seen)]) };
  }
}

// emitFrontmatter from src/services/agent-plugins/files.ts (base-serializer.ts has the same body).
function emitFrontmatter(data, content) {
  const nonEmpty = Object.entries(data).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (nonEmpty.length === 0) return content;
  return matter.stringify(content, Object.fromEntries(nonEmpty));
}

// The data `matter.stringify` dumps, or undefined when reading the content throws.
function merged(content, data) {
  try {
    return Object.assign({}, matter(content, {}).data, data);
  } catch {
    return undefined;
  }
}
// Whether the original writes `&ref_N` anchors (a collection shared through a YAML alias).
function writesRefs(m) {
  try {
    return m !== undefined && jsyaml.safeDump(m) !== jsyaml.safeDump(m, { noRefs: true });
  } catch {
    return false;
  }
}
// Whether the dumped data holds a lone surrogate (the content's frontmatter is a string with an
// astral character, which Object.assign spreads per UTF-16 unit).
function loneSurrogate(v) {
  if (typeof v === "string") return !v.isWellFormed();
  if (v && typeof v === "object" && !Buffer.isBuffer(v) && !(v instanceof Date)) return Object.values(v).some(loneSurrogate);
  return false;
}

const cases = [];
let skipped = 0;
function record(kind, content, data) {
  if (!content.isWellFormed()) { skipped++; return; }
  let c;
  try {
    c = { kind, content, data: enc(data) };
  } catch (e) {
    if (e instanceof Skip) { skipped++; return; }
    throw e;
  }
  matter.clearCache();
  try {
    const out = kind === "emit" ? emitFrontmatter(data, content) : matter.stringify(content, data);
    if (!out.isWellFormed()) { skipped++; return; }
    c.out = out;
  } catch (e) {
    c.err = { name: e.name, message: String(e.message) };
  }
  // What reaches safeDump: emitFrontmatter drops empty fields, or returns the content as is.
  const dumped = kind === "emit"
    ? Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined && value !== null && value !== ""))
    : data;
  const m = kind === "emit" && Object.keys(dumped).length === 0 ? undefined : merged(content, dumped);
  if (writesRefs(m)) c.refs = true;
  if (loneSurrogate(m)) c.loneSurrogate = true;
  cases.push(c);
}

// ── Hand-written values ────────────────────────────────────────────
// No astral characters here: those force double quotes, which would hide the block styles.
const words = ["lorem", "ipsum", "dolor", "sit", "amet,", "consectetur", "adipiscing", "elit", "a", "bb", "x-y", "été", "日本語", "q'q"];
const sentence = (n) => Array.from({ length: n }, (_, i) => words[i % words.length]).join(" ");
const strings = [
  "", " ", "  ", "a", "abc", "hello world", " leading", "trailing ", "\ttab", "tab\t", "a\tb", "both ", " both ",
  "true", "false", "True", "TRUE", "yes", "Yes", "YES", "no", "No", "NO", "on", "On", "ON", "off", "Off", "OFF", "y", "Y", "n", "N",
  "null", "Null", "NULL", "~", "nULL", "1", "-1", "+1", "0", "-0", "00", "007", "08", "0x1F", "0x1f", "0o17", "0b101", "1_000", "1:30", "190:20:30",
  "1.0", "1.5", ".5", "-.5", "1e3", "1E3", "1e+3", "1.5e-7", "6.8523015e+5", ".inf", "-.inf", ".Inf", ".NaN", ".nan", "NaN", "Infinity", "-Infinity",
  "2024-01-01", "2001-12-14t21:59:43.10-05:00", "2001-12-14 21:59:43.10 -5", "2024-1-1", "2024-01-01x", "<<", "<", "=", "==",
  "-", "--", "---", "- a", "-a", "?", "? a", "?a", ":", ": a", "a:", "a:b", "a: b", "a :b", "a,b", "[a]", "a[0]", "{a}", "a}", "#", "# c", "a#b", "a #b", "a# b",
  "&a", "*a", "!a", "!!str", "|", "|a", ">", ">a", "'", "'a'", "it's", "\"", "\"a\"", "say \"hi\"", "%", "%a", "@a", "a@b", "`a`", "a`b",
  "back\\slash", "\\", "a\nb", "a\n", "\n", "\n\n", "\na", "\n\na", "a\n\n", "a\n\n\n", "a\r\nb", "a\rb", "\r", "line1\nline2\nline3",
  " a\nb", "a\n b", "a\n  b\nc", "  indented\n  block\n", "\n  more\nless",
  "\u0000", "\u0007", "\u0008", "\u001b", "\u007f", "\u0085", "\u00a0", "a\u00a0b", "\u00a1", "\u2028", "\u2029", "a\u2028b", "\ufeff", "a\ufeffb",
  "\ufffd", "\ufffe", "\uffff", "\ue000", "\ud7ff", "é", "café", "naïve", "日本", "😀", "a😀b", "😀😀", "𝒳", "\u3000", "a\u3000", "\u3000a", "\u1680x\u2000",
  "x\u202f", "\u205f", "Ω≈ç√", "ﬁ", "İ", "ß",
  sentence(10), sentence(13), sentence(14), sentence(15), sentence(30), sentence(80),
  "a".repeat(79), "a".repeat(80), "a".repeat(81), "a".repeat(200), "a ".repeat(40), "a ".repeat(41), "ab ".repeat(30),
  "x".repeat(77) + " y", "x".repeat(78) + " y", "x".repeat(79) + " y", "x".repeat(80) + " y", "x".repeat(40) + " " + "y".repeat(40) + " z",
  "word  " + "two  spaces ".repeat(10), " " + sentence(20), sentence(20) + " ", sentence(20) + "\n", sentence(20) + "\n\n", "\n" + sentence(20),
  sentence(20) + "\n" + sentence(20), sentence(20) + "\n\n" + sentence(20), sentence(20) + "\n  indented " + sentence(20) + "\n" + sentence(20),
  "short\n" + sentence(25), sentence(25) + "\nshort", "  " + sentence(25) + "\n" + sentence(25), sentence(15) + "\u00e9" + sentence(15),
  sentence(20) + " #tag", sentence(20) + ": colon", sentence(20).replace(/ /g, "\t"), "a".repeat(100) + " " + "b".repeat(100),
  sentence(400), "k".repeat(1030), "k".repeat(1022), "k".repeat(1023), "k".repeat(1024), "k".repeat(1025), "k'".repeat(511),
  "short\n  " + sentence(30), "short\n  " + sentence(30) + "\n" + sentence(30), sentence(30) + "\n  in\nout\n\n  in2\n\nout2 " + sentence(30),
  "\n" + sentence(30) + "\n\n", " " + sentence(30) + "\n" + sentence(30), sentence(30) + "\n\n\n" + sentence(30) + "\n", sentence(30) + "😀", "q'".repeat(600), "line\n".repeat(30), "😀 ".repeat(50),
  "description: Search in three steps: search, timeline", "Use when the user asks: \"do X\"", "- bullet\n- list\n", "# Heading\n\nParagraph.\n",
  "```js\nconst a = 1;\n```\n", "C:\\path\\to\\file", "https://example.com/a?b=c#d", "mailto:a@b.c", "{{ template }}", "${VAR}", "$HOME", "~/path", "./rel",
];
const numbers = [0, -0, 1, -1, 42, 1.5, -1.5, 0.1, 0.30000000000000004, 1e21, 1e-7, 5e-7, 1.5e-7, 1e-6, 123e-20, 2 ** 53, 2 ** 53 + 2, -(2 ** 53), 1e20, 1e300,
  Number.MAX_VALUE, Number.MIN_VALUE, Number.EPSILON, NaN, Infinity, -Infinity, 1 / 3, 100, 1e5, 12345.678, -0.5, 3e21, 1.7976931348623157e308, 4294967295];
const others = [true, false, null, new Date(0), new Date("2024-01-01"), new Date(1700000000123), new Date(-1), new Date(-62198755200000), new Date(253402300800000),
  new Date(8.64e15), new Date(-8.64e15), new Date(NaN), Buffer.from(""), Buffer.from("H"), Buffer.from("He"), Buffer.from("Hel"), Buffer.from("Hello"),
  Buffer.from([0, 255, 128, 7]), Buffer.alloc(100, 7), undefined, [], {}, [[]], [{}], { a: [] }, { a: {} }];
const values = [...strings, ...numbers, ...others];

for (const v of values) {
  record("stringify", "body", { k: cl(v) });
  record("stringify", "body", { k: [cl(v)] });
  record("stringify", "body", { k: [[cl(v)], { n: cl(v) }] });
  let deep = cl(v);
  for (const k of "utsrqponmlkjihgfedcba") deep = { [k]: deep };
  record("stringify", "body", deep);
  record("stringify", "", { a: { b: cl(v) }, c: [cl(v), cl(v)] });
  if (typeof v === "string") {
    record("stringify", "body", { [v]: 1 });
    record("stringify", "body", { [v]: { [v]: [v] } });
  }
}
for (let depth = 0; depth < 30; depth++) {
  let v = sentence(18) + "\n" + sentence(6);
  for (let i = 0; i < depth; i++) v = i % 2 ? [v] : { k: v };
  record("stringify", "body", { top: v });
}

// Structures, keys and key order.
const structures = [
  {}, { a: 1 }, { b: 1, a: 2 }, { 2: "a", 1: "b", x: "c", 0: "d", "01": "e", 4294967295: "f", 4294967294: "g" },
  { a: [1, [2, [3, [4]]]], b: { c: { d: [] } } }, { list: [{ a: 1, b: 2 }, { c: [1, 2] }, [{ d: 3 }], []] },
  { seq: [[1, 2], [3, [4, 5]]] }, { empty: [{}, [], "", null] }, { "": "empty key" }, { " ": 1, "a b": 2, "a:b": 3, "-": 4, "?": 5 },
  JSON.parse('{"__proto__": 1, "a": 2}'), JSON.parse('{"__proto__": {"x": 1}, "a": 2}'), JSON.parse('{"a": {"__proto__": 3}}'),
  { constructor: 1, toString: 2, hasOwnProperty: 3 }, { name: "my-skill", description: "Does a thing.", tools: ["Read", "Write"], model: "sonnet" },
  { title: "Home", tags: ["a", "b"], date: new Date("2024-01-02T03:04:05Z"), draft: false, weight: 10, ratio: 0.5 },
  { [("k".repeat(1100))]: "explicit pair" }, { [("k".repeat(1100))]: { a: 1, b: [1] } }, { [("k".repeat(1100))]: [1, 2] }, { [("k".repeat(1100))]: "" },
  { ["😀".repeat(513)]: 1 }, { ["😀".repeat(512)]: 1 }, { ["a\nb".repeat(300)]: 1 },
  { a: [undefined] }, { a: { b: undefined } }, { a: [1, undefined, 2] },
];
for (const s of structures) {
  record("stringify", "body", cl(s));
  record("stringify", "", cl(s));
  record("emit", "body", cl(s));
}

// Contents: the content's own frontmatter, languages, excerpts, errors.
const contents = [
  "", "body", "body\n", "body\n\n", "\n", "\n\nbody", "line1\nline2", "---", "----", "---\n---", "---\n---\n", "---\n---\nbody",
  "---\ntitle: old\n---\nbody", "---\ntitle: old\nkeep: 1\n---\nbody\n", "---\r\ntitle: crlf\r\n---\r\nbody\r\n", "\uFEFF---\ntitle: bom\n---\nbody",
  "---\n2: two\n1: one\nz: z\n---\n", "---\nlist: [1, 2]\nmap: {a: 1}\n---\nbody", "---\nd: 2024-01-01\nb: !!binary SGk=\n---\n",
  "---\nfoo\n---\nbody", "---\n[a, b]\n---\nbody", "---\n😀x\n---\nbody", "---\n42\n---\nbody", "---\n!!binary SGVsbG8=\n---\n", "---\n~\n---\nbody",
  "---\nexcerpt_separator: <!-- more -->\n---\nintro\n<!-- more -->\nrest", "---\nexcerpt_separator: '  '\n---\na  b",
  "---json\n{\"a\": 1, \"b\": [1, 2]}\n---\nbody", "---json\n{}\n---\n", "---json\n5\n---\n", "---JSON\n---\nbody", "---toml\n---\nbody", "---js\n---\nbody",
  "---javascript\n---\n", "---coffee\n---\n", "---yml\na: 1\n---\nb", "---YAML\na: 1\n---\nb", "---constructor\n---\n", "---toString\n---\nx",
  "---__proto__\n---\n", "---\na: [\n---\nbody", "---\na: b: c\n---\nbody", "---\ntitle: x", "---\n# comment only\n---\nbody", "text\n---\na: 1\n---\n",
  "---\na: &x [1, 2]\nb: *x\n---\nbody", "---\na: &x {p: 1}\nb: *x\n---\n", "---\na: &x 5\nb: *x\n---\n", "---\nbase: &b {p: 1}\nd:\n  <<: *b\n  q: 2\n---\n",
  "---\nbase: &b {p: [1]}\nd:\n  <<: *b\n---\n", "---\n__proto__: {a: 1}\nb: 2\n---\n", "---\nk: undefined\n---\n", "---\nk: .nan\nj: -0\n---\n",
];
const contentData = [{}, { title: "new" }, { a: 1, title: "x" }, { 0: "zero", z: 1 }, JSON.parse('{"__proto__": 5}'), { k: undefined }, { d: new Date(NaN) }];
for (const content of contents) for (const data of contentData) record("stringify", content, cl(data));
for (const content of contents) {
  record("emit", content, { name: "n", description: "", model: null, extra: undefined });
  record("emit", content, { description: "", model: null });
}

// Repository markdown with frontmatter, read back and written again.
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "rust", "dist", ".worktrees"].includes(name)) continue;
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(md|mdc)$/.test(name) && st.size < 200000) out.push(p);
  }
  return out;
}
let repoFiles = 0;
for (const p of walk(".", []).sort()) {
  const text = readFileSync(p, "utf8");
  if (!text.startsWith("---")) continue;
  repoFiles++;
  record("stringify", text, {});
  record("stringify", text, { name: "override", extra: [1, "two"] });
  let parsed;
  try {
    parsed = matter(text, {});
  } catch {
    continue;
  }
  record("stringify", parsed.content, parsed.data);
  record("emit", parsed.content, parsed.data);
}

// Random values.
const charPool = ["a", "b", "z", "A", "0", "1", "9", " ", " ", " ", "  ", "\t", "\n", "\n", "\r", "-", "?", ":", ",", "[", "]", "{", "}", "#", "&", "*", "!", "|",
  ">", "'", "\"", "%", "@", "`", "\\", "=", "<", ".", "e", "x", "_", "~", "é", "日", "😀", "\u00a0", "\u0085", "\u2028", "\u0000", "\u001f", "\u007f", "\ufeff",
  "\u3000", "\ufffd", "yes", "no", "true", "null", "1.5", "2024-01-01", "0x1", "<<", "ab cd ef ", "lorem ipsum "];
function randString() {
  const r = rand();
  if (r < 0.15) return pick(strings);
  if (r < 0.3) {
    const n = int(160);
    let s = "";
    while (s.length < n) s += pick(words) + pick([" ", " ", " ", "  ", "\n", "\n\n", "\n  "]);
    return rand() < 0.5 ? s.trimEnd() : s;
  }
  return Array.from({ length: int(12) }, () => pick(charPool)).join("");
}
function randNumber() {
  const r = rand();
  if (r < 0.3) return pick(numbers);
  if (r < 0.5) return int(2000) - 1000;
  if (r < 0.7) return (rand() - 0.5) * 10 ** (int(50) - 25);
  if (r < 0.85) return Math.round(rand() * 1e6) / 1000;
  return (rand() < 0.5 ? -1 : 1) * 2 ** int(80);
}
function randValue(depth) {
  const r = rand();
  if (depth > 4 || r < 0.5) {
    const s = rand();
    if (s < 0.6) return randString();
    if (s < 0.82) return randNumber();
    if (s < 0.88) return pick([true, false, null]);
    if (s < 0.94) return new Date(Math.round((rand() - 0.3) * 1e13));
    if (s < 0.97) return Buffer.from(Array.from({ length: int(70) }, () => int(256)));
    if (s < 0.975) return undefined;
    return cl(pick(others));
  }
  if (r < 0.72) return Array.from({ length: int(5) }, () => randValue(depth + 1));
  const o = {};
  for (let i = int(5); i > 0; i--) o[rand() < 0.75 ? pick(["name", "description", "a", "b", "tools", "1", "0", "x y", "key"]) : randString()] = randValue(depth + 1);
  return o;
}
for (let i = 0; i < 4000; i++) {
  const data = {};
  for (let n = 1 + int(5); n > 0; n--) data[rand() < 0.7 ? pick(["name", "description", "model", "tools", "globs", "alwaysApply", "3", "x"]) : randString()] = randValue(1);
  record(rand() < 0.8 ? "stringify" : "emit", rand() < 0.8 ? "body\n" : pick(contents), data);
}

const stats = {
  total: cases.length,
  ok: cases.filter((c) => "out" in c).length,
  err: cases.filter((c) => c.err).length,
  refs: cases.filter((c) => c.refs).length,
  loneSurrogate: cases.filter((c) => c.loneSurrogate).length,
  repoFiles,
  skipped,
};
writeFileSync(new URL("./fixtures/stringify.json", import.meta.url), JSON.stringify({ generator: "make-stringify-fixtures.mjs", stats, cases }) + "\n");
console.log(JSON.stringify(stats));
