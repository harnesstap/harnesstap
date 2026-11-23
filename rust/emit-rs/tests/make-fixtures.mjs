// Records what the original's emitters print, as fixtures for tests/fixtures.rs.
// Run from the repository root: node rust/emit-rs/tests/make-fixtures.mjs
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";

const YAML_OPTIONS = { indent: 2, lineWidth: 0, defaultKeyType: "PLAIN" };
const here = "rust/emit-rs/tests/fixtures";

// mulberry32: a fixed seed keeps the fixtures stable between runs
let seed = 0x5eed;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(random() * list.length)];

const TOKENS = [
  "a", "b", "Z", "0", "1", "42", " ", "  ", "\t", "\n", "\n\n", "\r", ":", "-", "?", "#", '"', "'",
  "%", ".", "!", "&", "*", "[", "]", "{", "}", ",", "|", ">", "@", "`", "~", "\\", "e", "x", "o",
  "é", "€", "😀", "\u0000", "\u0007", "\u000b", "\u001b", "\u001f", "\u007f", "\u0085", "\u00a0",
  "\u2028", "\u2029", "\ufeff", "true", "null", "NULL", "---", "...", "0x1F", "0o7", "1e3", ".5",
  "-1.5", ".inf", ".NaN", "word", "two words", "https://example.com/a?b=c#d", "sha256:abc",
];
const randomString = () => {
  const n = Math.floor(random() * 7);
  let s = "";
  for (let i = 0; i < n; i++) s += pick(TOKENS);
  return random() < 0.1 ? s.repeat(8) : s;
};
// -0 is left out: the fixture file itself is JSON, which drops the sign
const NUMBERS = [0, 1, -1, 42, 1.5, -2.25, 0.1, 1e21, 1e-7, 123456789012, 2 ** 53, 1e300, 5e-324];
const randomKey = () => (random() < 0.15 ? pick(["0", "1", "10", "2", "01", "-1", "4294967294"]) : randomString());
const randomValue = (depth) => {
  const r = random();
  if (depth > 3 || r < 0.45) {
    const s = random();
    if (s < 0.6) return randomString();
    if (s < 0.8) return pick(NUMBERS);
    if (s < 0.9) return random() < 0.5;
    return null;
  }
  const n = Math.floor(random() * 4);
  if (r < 0.7) {
    const obj = {};
    for (let i = 0; i < n; i++) obj[randomKey()] = randomValue(depth + 1);
    return obj;
  }
  return Array.from({ length: n }, () => randomValue(depth + 1));
};

const values = [];
// every token alone, as a value, a key, a list item, and long
for (const t of TOKENS) {
  values.push(t, { [t]: t }, [t], { k: [t, { [t]: t }] }, t.repeat(30), { k: `${t.repeat(25)}\n${t}` });
}
values.push(
  {}, [], null, true, 42, "", { "": "" }, { a: {}, b: [], c: [[]], d: [{}] },
  { long: "x".repeat(1100) }, { ["k".repeat(1030)]: 1 }, { ["k".repeat(1030)]: { a: 1 } },
  "line one\nline two\n", "  lead\nnext", "\n\nlead\ntrail\n\n", "trail \n", "a\n  \n", "tab\t\nx",
  { s: "a long double quoted value with a \u0007 bell\nand then more text\n\n and a space" },
);
// around doubleQuotedMinMultiLineLength (40)
for (let n = 30; n < 46; n++) values.push({ k: `\u0007${"x".repeat(n)}\ny` }, [`${"x".repeat(n)}\n\n z \u0001`]);
for (let i = 0; i < 3000; i++) values.push(randomValue(0));

// documents the recorded cases read or write
const docs = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ya?ml|json)$/.test(name)) docs.push(p);
  }
};
walk("rust/app-cases");
docs.sort();
const jsonValues = [...values];
for (const p of docs) {
  const text = readFileSync(p, "utf8");
  try {
    if (p.endsWith(".json")) jsonValues.push(JSON.parse(text));
    else values.push(parse(text));
  } catch {
    // not every file parses; the recorded cases cover those
  }
}

const lines = (list, emit, key = "output") =>
  list.map((input) => JSON.stringify({ input, [key]: emit(input) })).join("\n") + "\n";
writeFileSync(`${here}/yaml.jsonl`, lines(values, (v) => stringify(v, YAML_OPTIONS)));
writeFileSync(
  `${here}/json.jsonl`,
  lines(jsonValues, (v) => JSON.stringify(v, null, 2)) +
    lines(values.slice(0, 500), (v) => JSON.stringify(v), "compact"),
);
console.log(`yaml: ${values.length} cases, json: ${jsonValues.length + 500} cases`);
