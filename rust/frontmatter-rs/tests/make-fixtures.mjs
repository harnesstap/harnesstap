// Records gray-matter / js-yaml answers for tests/fixtures.rs.
// Run from the repo root under Node with TZ=UTC:
//   TZ=UTC node rust/frontmatter-rs/tests/make-fixtures.mjs
import { readFileSync, writeFileSync, readdirSync, lstatSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { parseFrontmatter, parseFrontmatterLenient } from "../../../src/utils/frontmatter.ts";

const require = createRequire(import.meta.url);
const jsyaml = require("js-yaml");
if (!jsyaml.safeLoad || !/^3\./.test(require("js-yaml/package.json").version)) {
  throw new Error("expected js-yaml 3 at the repo root");
}
if (process.env.TZ !== "UTC") throw new Error("run with TZ=UTC");

let seed = 0x5eed1234;
function rand() {
  seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0;
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 0x297a2d39);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const int = (n) => Math.floor(rand() * n);

class Unsupported extends Error {}

function enc(v, seen = new Set()) {
  if (v === undefined) return { $undef: true };
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") return { $num: Object.is(v, -0) ? "-0" : String(v) };
  if (typeof v === "string") return v.toWellFormed();
  if (seen.has(v)) throw new Unsupported("cycle");
  seen.add(v);
  try {
    if (v instanceof Date) return { $date: String(v.getTime()) };
    if (Buffer.isBuffer(v)) return { $buf: [...v] };
    if (Array.isArray(v)) return v.map((x) => enc(x, seen));
    if (Object.getPrototypeOf(v) !== Object.prototype) throw new Unsupported("exotic object");
    return { $obj: Object.keys(v).map((k) => [k.toWellFormed(), enc(v[k], seen)]) };
  } finally {
    seen.delete(v);
  }
}

function encFile(f) {
  const out = { data: enc(f.data), content: f.content.toWellFormed(), excerpt: f.excerpt.toWellFormed() };
  for (const k of ["isEmpty", "empty", "language", "matter"]) {
    if (f[k] !== undefined) out[k] = typeof f[k] === "string" ? f[k].toWellFormed() : f[k];
  }
  return out;
}

const PROTO = new Set(Object.getOwnPropertyNames(Object.prototype));
function language(text) {
  const s = text.replace(/^\uFEFF/, "");
  if (!s.startsWith("---") || s[3] === "-") return null;
  const rest = s.slice(3);
  return rest.slice(0, rest.search(/\r?\n/)).trim();
}

function record(kind, input) {
  const c = { kind, input: input.toWellFormed() };
  try {
    if (kind === "load") {
      const v = jsyaml.safeLoad(input);
      c.ok = v === undefined ? { $undef: true } : enc(v);
    } else {
      const lang = language(input);
      if (lang && (/^(js|javascript)$/i.test(lang) || PROTO.has(lang))) {
        c.unsupported = "engine";
        return c;
      }
      c.ok = encFile(kind === "parse" ? parseFrontmatter(input) : parseFrontmatterLenient(input));
    }
  } catch (e) {
    if (e instanceof Unsupported) {
      c.unsupported = e.message;
    } else {
      c.err = { name: e.name, message: e.name === "SyntaxError" ? "" : String(e.message).toWellFormed() };
    }
  }
  return c;
}

// Hand-written YAML covering the loader's paths.
const yamlCases = [
  "", " ", "\n", "# c", "#", "a", "a: 1", "a: b: c", "a:\n  b: 1\n  c: [1, 2]", "- a\n- b\n-\n- - x\n  - y",
  "? a\n: b\n? c\n", "? [a, b]\n: 1", "{a: 1, b: [x, y], c: {d: e}}", "[a, {b: c}, d: e, ? f : g]", "[1, 2,]", "[1 2]",
  "{a: 1, a: 2}", "a: 1\na: 2", "a: 1\nb: 2\n  c: 3", "key: 'it''s'", 'key: "a\\tb\\u00e9\\x41\\U0001F600\\ud800\\N\\_\\L\\P\\/ \\e"',
  'k: "\\q"', 'k: "\\xZZ"', "k: 'open", 'k: "open', "k: |\n  line1\n  line2\n\n  line4\n", "k: >\n  a\n  b\n\n  c\n    d\n  e\n",
  "k: |-\n  x\n\n", "k: |+\n  x\n\n\n", "k: |2\n   x\n  y\n", "k: |0\n x", "k: |++\n x", "k: |22\n x", "k: >-  # c\n  folded\n",
  "k: | x\n y", "a: &x 1\nb: *x", "a: &x [1, 2]\nb: *x", "a: &x {p: 1}\nb:\n  <<: *x\n  q: 2", "a: &x {p: 1}\nb: {<<: [*x, {r: 3}], p: 9}",
  "b:\n  <<: 5", "a: *nope", "&a foo", "&a [1]", "a: &a\n  - 1\n  - *a", "x: &a !!str 5\ny: *a", "&a &b x", "!!str !!int x", "*a",
  "a: !!str 123", "a: !!int '0x1F'", "a: !!float 1", "a: !!bool yes", "a: !!null ''", "a: !!null", "a: !!str", "a: !!seq", "a: !!map", "a: !!int",
  "a: !!binary SGVsbG8gd29ybGQ=", "a: !!binary |\n  SGVs\n  bG8=", "a: !!binary bad*", "a: !!set {x, y}", "a: !!set {x: 1}", "a: !!omap [a: 1, b: 2]",
  "a: !!omap [a: 1, a: 2]", "a: !!pairs [a: 1, a: 2]", "a: !!pairs [1]", "a: !!timestamp 2001-12-14", "a: !!timestamp nope", "a: !!merge <<", "a: !!merge x",
  "a: !foo x", "a: !<tag:yaml.org,2002:str> 1", "a: !<?> 12", "a: !<?> [1]", "a: ! 12", "a: !!str [1]", "a: !!map [1]", "%TAG !e! tag:yaml.org,2002:\n---\na: !e!int 7",
  "%YAML 1.2\n---\na: 1", "%YAML 1.1\n%YAML 1.2\n---\n", "%YAML 2.0\n---\n", "%YAML x\n---\n", "%YAML 1.2\na: 1", "%FOO bar\n---\nx", "%\n---\n",
  "%TAG ! ! extra\n---\n", "%TAG !e! a\n%TAG !e! b\n---\n", "a: !e!x 1", "a: !e!x!y 1", "a: !x,y 1", "a: !<x 1", "a: !<x> 1", "a: !%zz 1", "a: !%41 1",
  "---\na: 1\n---\nb: 2", "---\na: 1\n...\n", "a: 1\n...\n---\n", "--- x\n", "--- |\n  x\n", "a: 1\n--- \n", "null", "~", "Null", "NULL", "nULL",
  "true", "True", "TRUE", "tRUE", "yes", "false", "0", "-0", "+0", "00", "-00", "07", "08", "0o7", "0b1010", "0b", "0x", "0x1_F", "0xFFFFFFFFFFFFFFFFFF",
  "0b" + "1".repeat(70), "123456789012345678901234567890", "1_000", "_1", "1_", "1__0", "190:20:30", "1:60", "-1:30", "1:30.5", "1:30.5e3", "1.5", "1.", ".5",
  "-.5", "+.5", "1e5", "1E5", "1.5e-5", "1.e5", "1e", "6.8523015e+5", "685.230_15e+03", ".inf", "-.Inf", "+.INF", ".NaN", ".nan", "-.nan", ".Nan", "1_.5", "0.1_",
  "2001-12-14", "2001-12-14t21:59:43.10-05:00", "2001-12-14 21:59:43.10 +5", "2001-12-14T21:59:43Z", "2001-12-14 21:59:43.1234567", "2001-1-1 1:00:00",
  "0050-01-01", "2001-13-40", "2001-02-30 25:61:61 +99:99", "9999-12-31T23:59:59.999-12:00", "2001-12-14 21:59:43   Z", "a: 2001-12-14\n2001-12-15: b",
  "[2001-12-14]: x", "? [a, [b]]\n: 1", "? {a: 1}\n: 2", "? [{a: 1}, 2]\n: 3", "? !!binary SGk=\n: 1", "? 1.5\n: x", "? .inf\n: x", "? ~\n: x", "? true\n: x",
  "__proto__: 1", "__proto__: {a: 1}", "a: &__proto__ 1\nb: *__proto__", "constructor: 1\ntoString: 2", "2: a\n1: b\nx: c\n0: d\n01: e\n4294967295: f\n4294967294: g",
  "a:\tb", "a:\n\tb", "\ta: 1", "a: b\tc", "- \ta", "a: 'x\n  y'", "a: \"x\n\n  y\"", "a: x\n  y\n\n  z", "a: x # c\n", "a: x#y", "a: x #", "a: [x # c\n , y]",
  "a: - x", "- a: 1\n  b: 2\n- c: 3", "- - - x", "-a", "- ", "-\n-\n", "a:\n- x\n- y", "a:\n  - x\n - y", "  a: 1\n  b: 2", "  a: 1\nb: 2", "a: 1\n b: 2",
  "a\nb", "a: b\nc", "a: b\n- c", "[a\n, b]", "{a\n: b}", "{a: b\n}", "[", "{", "]", "}", "a: ]", "a: {b", "a: [b", "'a': 1", '"a": 1', "'a\nb': 1",
  "@a", "`a", "%a", "|a", ">a", "a: @b", "a: b@c", "? x", "?", ":", ": x", "? a\n? b", "a: ? b", "x: [? a : b]", "[a: b, c]", "{a, b: c}", "{? a}",
  "a: \u0007", "a: '\u0007'", "a: \"\u0007\"", "a: \u0085b", "a: b\u2028c", "\uFEFFa: 1", "a: 1\u0000", "a: \uFFFE", "a: é😀", "é: 1", "a: \"\\uD83D\\uDE00\"",
  "a: |\n  \u0001", "a: >\n\n  x", "a: >\n  x\n\n\n", "a: |\n  x\n   y\n  z", "a: >\n  x\n   y\n  z", "- |\n  x\n- >\n  y", "a: |\n\n\n", "a: |\n x\n  y\nb: 1",
  "a: !!str |\n  x", "a: &x |\n  x\nb: *x", "a: \"x\\\n  y\"", "a: \"\\\n\"", "a: 'x\n\n\n  y'", "a:\n\n\n  b", "a: b\r\nc: d\r\n", "a: b\rc: d", "a: 'b\r\n c'",
  "x: \"" + "y".repeat(100) + "", "k" + "x".repeat(60) + ": [" + "z".repeat(60), "a:" + " ".repeat(50) + "b: c", "a\u2028: 1", "- a\n-b", "a: [1, 2]: 3",
  "a: {b: [c, {d: [e]}]}\nf: *g", "? - a\n  - b\n: c", "? |\n  block key\n: v", "a: !!omap\n  - a: 1\n  - b: 2", "a: !!pairs\n  - a: 1\n  - a: 2", "a: !!set\n  ? x\n  ? y",
  "excerpt_separator: '<!-- more -->'", "x: &x {__proto__: 1}\ny:\n  <<: *x\n  __proto__: 2", "[? a\n : b]", "{? a\n : b}",
  "- &a\n  foo\n- *a", "x: &a\n  foo\ny: *a", "x: &a\n  foo: 1\ny: *a", "0099-01-01", "0000-01-01 00:00:00", "!!binary SG", "!!binary SGk",
  "0b1" + "0".repeat(52) + "1" + "0".repeat(100) + "1", "0b1" + "0".repeat(52) + "1" + "0".repeat(100), "-0x0", "-0b0", "-0.0", "-0:0", "a: 1\n  # comment\nb: 2", "# only\n# comments", "a: 1 #c\n#d\nb: 2 # e", "[a, b]: c", "{a: b}: c", "[[a]]: c",
];

const gmCases = [
  "", "---", "----", "---\n---", "---\n---\n", "---\n---\nbody", "---\ntitle: x\n---\nbody", "---\ntitle: x\n---", "---\ntitle: x\n----\nbody",
  "---\ntitle: x\n---extra\nbody", "---\r\ntitle: x\r\n---\r\nbody\r\n", "---\r\ntitle: x\r\n---\r\n\r\nbody", "\uFEFF---\ntitle: x\n---\nbody", "---\ntitle: x",
  "---yaml\na: 1\n---\nb", "--- yaml \na: 1\n---\nb", "---yml\na: 1\n---\n", "---YAML\na: 1\n---\n", "---json\n{\"a\": 1}\n---\nbody", "---json\n{\"a\": \n---\n",
  "---json\n5\n---\n", "---json\nnull\n---\n", "---JSON\n{}\n---\n", "---toml\na = 1\n---\n", "---coffee\na: 1\n---\n", "---js\n{a: 1}\n---\n", "---constructor\na\n---\n",
  "---x", "---😀", "---yaml😀", "---\n# just a comment\n---\nbody", "---\n#\n---\nbody", "---\n   # indented\n\n---\n", "---\n\n\n---\n", "---\n  \n---\nx",
  "---\n~\n---\nbody", "---\nhello\n---\nbody", "---\n[1, 2]\n---\nbody", "---\n!!binary SGk=\n---\n", "---\na: 1\n---\nbody\n---\nmore", "text\n---\na: 1\n---\n",
  " ---\na: 1\n---\n", "---\nexcerpt_separator: <!-- more -->\n---\nintro\n<!-- more -->\nrest", "---\nexcerpt_separator: ''\n---\nx---y", "---\nexcerpt_separator: 5\n---\na5b",
  "---\nexcerpt_separator: [a, b]\n---\nxa,by", "---\nexcerpt_separator: {a: 1}\n---\n[object Object]!", "---\nexcerpt_separator: true\n---\nistrue", "---\nexcerpt_separator: missing\n---\nbody",
  "---\nexcerpt_separator: 2001-12-14\n---\nFri Dec 14 2001", "---\n#\n\n---\nbody", "---yaml\r\na: 1\r\n---\r\nb",
  "---\nexcerpt_separator: 0\n---\na0b", "---\nexcerpt_separator: .nan\n---\naNaNb", "---\nexcerpt_separator: 1.5\n---\na1.5b", "---\na: [\n---\nbody", "---\na: b: c\n---\nbody", "---\ndescription: Search in three steps: search, timeline\nname: x\n---\nbody",
  "---\r\ndescription: a: b\r\n---\r\nbody", "---\ndescription: a: b\n# note\n\nname: y\n---   \nbody", "---\ndescription: a: b\nlist: [1, 2\n---\n", "---\ndescription: a: b\nx: |\n---\n",
  "---\ndescription: a: b\n  indented: 1\n---\n", "---\ndescription: a: b\n__proto__: p\n2: two\n---\n", "---\ndescription: a: b\nempty:\n---\n", "---\ndescription: a: b\n---",
  "---\ndescription: a: b\n--- x\n", "---\ndescription: a: b\u2028c\n---\n", "---\ndescription: a: b\rc: d\n---\n", "---\ndescription: a: b\n---\r\nbody", "---\nname: x\ndescription: a: b\n---\n---\n",
];

const corpus = [];
for (const y of yamlCases) {
  corpus.push(["load", y]);
  corpus.push(["parse", `---\n${y}\n---\nbody`]);
  corpus.push(["lenient", `---\n${y}\n---\nbody`]);
}
for (const g of gmCases) for (const k of ["parse", "lenient"]) corpus.push([k, g]);

// Repository markdown with frontmatter.
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "rust", "dist"].includes(name)) continue;
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
  corpus.push(["parse", text]);
  corpus.push(["lenient", text]);
}

// Structured random documents.
const scalars = ["a", "b c", "x y z", "1", "-2", "0x1f", "0o7", "012", "1.5", "-.inf", ".nan", "true", "False", "~", "null", "2001-12-14",
  "2001-12-14 21:59:43.10 -5", "190:20:30", "'q''s'", "\"d\\te\\u00e9\"", "\"\\x41\"", "é", "😀", "''", "\"\"", "1_0", "<<", "a: b", "#x", "-", "?", "@x",
  "1e3", "+1", "0b11", ".5", "yes", "NULL", "'multi\n  line'", "!!str 7", "!!binary SGk=", "!!int '9'", "!!float 2", "!!null", "!!timestamp 2002-01-01"];
const keys = ["a", "b", "key", "name", "description", "1", "0", "__proto__", "constructor", "x y", "'q'", "\"d\"", "é", "2001-12-14", "~", "true", "1.5", "<<"];
function genNode(depth, indent, anchors) {
  const r = rand();
  const pad = " ".repeat(indent);
  let prefix = "";
  if (rand() < 0.08) { const a = pick(["x", "y", "z"]); anchors.push(a); prefix = `&${a} `; }
  if (rand() < 0.05) prefix += pick(["!!map ", "!!seq ", "!!str ", "!!set ", "!!omap ", "!!pairs ", "! "]);
  if (depth > 3 || r < 0.45) {
    if (anchors.length && rand() < 0.1) return { inline: `*${pick(anchors)}` };
    if (rand() < 0.08) return { block: `${prefix}${pick(["|", ">", "|-", ">+", "|2"])}\n${pad}  ${pick(scalars)}\n${pad}  ${pick(scalars)}\n` };
    return { inline: prefix + pick(scalars) };
  }
  if (r < 0.6) {
    const items = Array.from({ length: int(4) }, () => genFlow(depth + 1, anchors));
    return { inline: prefix + (rand() < 0.5 ? `[${items.join(", ")}]` : `{${items.map((v) => `${pick(keys)}: ${v}`).join(", ")}}`) };
  }
  const lines = [];
  const n = 1 + int(4);
  const seq = r < 0.78;
  for (let i = 0; i < n; i++) {
    const child = genNode(depth + 1, indent + 2, anchors);
    const head = seq ? "- " : `${rand() < 0.05 ? "? " : ""}${pick(keys)}${rand() < 0.03 ? "" : ":"} `;
    if (child.inline !== undefined) lines.push(`${pad}${head}${child.inline}${rand() < 0.1 ? " # c" : ""}`);
    else if (child.block) lines.push(`${pad}${head}${child.block.replace(/\n$/, "")}`);
    else lines.push(`${pad}${head.trimEnd()}\n${child.lines}`);
    if (rand() < 0.05) lines.push(`${pad}# comment`);
    if (!seq && rand() < 0.04) lines.push(`${pad}<<: ${anchors.length ? `*${pick(anchors)}` : "{m: 1}"}`);
  }
  return { lines: (prefix ? `${pad}${prefix.trim()}\n` : "") + lines.join("\n") };
}
function genFlow(depth, anchors) {
  if (depth > 4 || rand() < 0.6) return pick(scalars.filter((s) => !s.includes("\n")));
  return rand() < 0.5 ? `[${genFlow(depth + 1, anchors)}, ${genFlow(depth + 1, anchors)}]` : `{${pick(keys)}: ${genFlow(depth + 1, anchors)}}`;
}
function genDoc() {
  const node = genNode(0, 0, []);
  return node.lines ?? node.inline ?? node.block;
}
function mutate(s) {
  const chars = [...s];
  const ops = 1 + int(3);
  for (let i = 0; i < ops; i++) {
    const at = int(chars.length + 1);
    const r = rand();
    if (r < 0.35) chars.splice(at, 1);
    else if (r < 0.7) chars.splice(at, 0, pick([" ", "\n", ":", "-", "#", "'", "\"", "[", "]", "{", "}", ",", "&a", "*a", "!", "|", ">", "\t", "?", "\\", "%", "é", "\r"]));
    else chars.splice(at, 1, pick(["  ", "\n  ", ": ", "- ", "\n- "]));
  }
  return chars.join("");
}
for (let i = 0; i < 1800; i++) {
  const doc = genDoc();
  corpus.push(["load", doc]);
  corpus.push([rand() < 0.5 ? "parse" : "lenient", `---\n${doc}\n---\nbody`]);
  const m = mutate(doc);
  corpus.push(["load", m]);
  corpus.push(["lenient", `---\n${m}\n---\nbody`]);
}
for (let i = 0; i < 400; i++) corpus.push(["load", mutate(pick(yamlCases))]);
// Flat key: value blocks for the lenient fallback.
const flatValues = ["plain", "has: colon", "a: b: c", "[x", "{y", "|z", ">w", "&a", "*b", "!t", "", "  spaced  ", "é: 😀", "'q': r", "# not comment", "x\ty: z"];
for (let i = 0; i < 300; i++) {
  const lines = Array.from({ length: 1 + int(4) }, () => (rand() < 0.1 ? pick(["", "# c", "  # c", "bad line", " k: v", "k-1_x: v", "k.x: v"]) : `${pick(["name", "description", "a_b", "x-y", "N2", "__proto__", "3"])}:${pick([" ", "\t", "", "  "])}${pick(flatValues)}`));
  const eol = rand() < 0.2 ? "\r\n" : "\n";
  corpus.push(["lenient", `---${eol}${lines.join(eol)}${eol}---${pick(["", " ", "\t"])}${pick([eol, ""])}${pick(["body", "", "\n---\nx"])}`]);
}

const cases = corpus.map(([kind, input]) => record(kind, input));
const stats = { total: cases.length, ok: cases.filter((c) => c.ok).length, err: cases.filter((c) => c.err).length, unsupported: cases.filter((c) => c.unsupported).length, repoFiles };
writeFileSync(new URL("./fixtures/frontmatter.json", import.meta.url), JSON.stringify({ generator: "make-fixtures.mjs", stats, cases }) + "\n");
console.log(JSON.stringify(stats));
