// Records localeCompare from Node for the Rust test.
// Run: node rust/collate-rs/tests/make-fixtures.mjs
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const pieces = [
  "", "a", "A", "b", "B", "z", "Z", "0", "1", "9", "10", " ", "\t", "\n", "_", "-", ".", "/", "~", "$", "@",
  "é", "e", "E", "É", "è", "ê", "ë", "ü", "u", "ß", "ss", "İ", "i", "I", "ı", "Σ", "σ", "ς", "Ω", "日本", "語",
  "テキスト", "😀", "👍🏽", "\u{feff}", "\u0001", "\u007f", "\u00a0", "ﬁ", "K", "\u212a", "æ", "ae", "ø", "o", "å",
  "ñ", "n", "ç", "c", "claude", "claude-code", "claudecode", "Claude", "cursor", "codex", "a\u0301", "\u0301",
  "Ⅻ", "½", "①", "ｱ", "ア", "あ", "한", "ق", "א", "ж", "Ж",
];
let seed = 7;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
const strings = new Set(pieces);
while (strings.size < 1500) {
  let s = "";
  const k = 1 + rnd(4);
  for (let i = 0; i < k; i++) s += pieces[rnd(pieces.length)];
  strings.add(s);
}
const all = [...strings];
const pairs = [];
for (let i = 0; i < 6000; i++) {
  const a = all[rnd(all.length)], b = all[rnd(all.length)];
  pairs.push([a, b, Math.sign(a.localeCompare(b))]);
}
for (const a of pieces) for (const b of pieces) pairs.push([a, b, Math.sign(a.localeCompare(b))]);
const sorted = [...all].sort((a, b) => a.localeCompare(b));
writeFileSync(join(import.meta.dirname, "fixtures", "collate.json"), JSON.stringify({ pairs, input: all, sorted }));
console.log(`${pairs.length} pairs, ${all.length} strings`);
