// Records picomatch 4 as the app calls it, `picomatch(pattern, { dot: true })` on a POSIX
// platform: the regular expression `makeRe` builds and the matcher's answers.
// Run from the repository root: node rust/picomatch-rs/tests/make-fixtures.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const picomatch = require("../../../node_modules/picomatch");
const version = require("../../../node_modules/picomatch/package.json").version;
const options = { dot: true, windows: false };

let seed = 0x9c0a7c;
const rnd = (n) => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) % n;
};
const pick = (a) => a[rnd(a.length)];

const fixed = [
  "*", "**", "***", "**/**", "**/**/**", ".*", "*.*", "*/*", "**/*", "**/*.*", "**/.*", "*.md", "**/*.md",
  "*.d.ts", "./*.md", "./**/x", "a/*", "a/**", "a/**/b", "a/**/", "**/a", "a/**/**/b", "a/*/b", "/a/*",
  "a?", "?a", "??", "a/?", "[abc]", "[a-c]x", "[!a]", "[^a]", "[]]", "[]a]", "[a-]", "[[:alpha:]]",
  "[[:digit:]x]", "[[:foo:]]", "a[", "a]", "[a", "{a,b}", "{a,b}/*", "a{b,c}d", "{a..c}", "{1..3}",
  "{a,{b,c}}", "{,a}", "a{}", "{a}", "a{", "a}", "!a", "!!a", "!!!a", "!*.md", "!(a)", "!(a|b)", "!(*.d).ts",
  "**/!(*-dbg).@(js)", "@(a|b)", "+(a|b)", "*(a|b)", "?(a|b)", "+(a)", "*(a)*(b)", "+(a|aa)", "*(a|)",
  "a+b", "a+(b)", "(a|b)", "(a)", "a(b", "a)", "\\*", "\\a", "a\\", "a\\/b", "a\\.b", "\\\\a", "\\\\\\a",
  "a$b", "a^b", "\"a*b\"", "a\"b", "a|b", "a,b", "a.b", "..", "../a", "a/../b", "a/./b", "./a", ".a/*",
  "*.{md,txt}", "src/**/*.{ts,tsx}", "@scope/*", "github.com/org/*", "github.com/*/repo", "org/*",
  "*/private-*", "https://github.com/**", "git@github.com:org/*", "~/x", "a b", " a", "a ", "é*", "日本/*",
  "a/**/b/**/c", "**/node_modules/**", "*.min.js", "dist/**", "!dist/**", "#x", "x#", "a\\d", "\\d+",
  "(?:a)", "(?=a)", "(?!a)", "(?<a>b)", "?(", "*(", "+(", "@(", "!(", "a*(", "*(*)", "+(*)", "x/**/",
  // Nested repeated extglobs, which the original rewrites as literals.
  "+(+(a))", "*(+(a))", "+(a|+(b))", "*(*(a))", "+(@(a))", "+(a|aa)", "*(a|a)", "+(a|)", "*(?|a)",
  // Runs of backslashes, collapsed past two.
  "a/\\b", "a/\\\\b", "a/\\\\\\b", "a/\\\\\\\\b", "(\\\\\\x)", "[\\\\\\]",
  // Brace ranges, in and out of order.
  "{a..c}", "{c..a}", "{9..1}", "{z..a}/x", "{1..9}/x", "{a..c}{1..2}", "{-..a}", "{0..z}", "{a..}", "{..a}",
  "*/./*", "a/.*/b", "./.a/*", "x/*.", "x/.*", "*./*", "{a,.b}/*", "(./a)", ".a/b/*",
];
const atoms = [
  "a", "b", "x", ".", "..", "/", "*", "**", "?", "[", "]", "!", "^", "{", "}", ",", "(", ")", "|", "+", "@",
  "\\", "-", "a-c", "md", ".md", "$", "\"", ":", "[:alpha:]", "~", " ", "é",
];
const patterns = new Set(fixed);
// PICOMATCH_COUNT and PICOMATCH_OUT make larger local runs; the committed fixture uses the defaults.
const count = Number(process.env.PICOMATCH_COUNT ?? 4000);
if (process.env.PICOMATCH_SEED) seed = Number(process.env.PICOMATCH_SEED);
while (patterns.size < count) {
  let p = "";
  for (let i = 0, n = 1 + rnd(7); i < n; i++) p += pick(atoms);
  patterns.add(p);
}

const inputFixed = [
  "a", "b", "aa", "ab", "x", ".a", "a.md", "b.md", ".md", "a/b", "a/b/c", "a/x/b", "a/.x/b", "a/b.md",
  "x/a.md", "x/y/a.md", ".git/config", "a/", "/a", "/a/b", "./a", "../a", "a/../b", "a.d.ts", "a.ts", "a-dbg.js",
  "a.js", "src/x.ts", "src/a/b.tsx", "dist", "dist/a.js", "node_modules/a/b", "1", "2", "c", "]", "[",
  "a]", "a[", "{a,b}", "a,b", "a b", "é", "éa", "日本/x", "@scope/pkg", "github.com/org/repo",
  "https://github.com/org/repo", "git@github.com:org/repo", "org/repo", "a+b", "a$b", "a^b", "a|b", "*", "?",
  "\\", "a\\b", "ad", "a1", "#x", "!a", "(a)", "a\r", "a\nb", "..", ".", "a/.", "a/..", "-", ":", "a)", "a(b",
];
const inputs = [...inputFixed];
for (let i = 0; i < 40; i++) {
  let s = "";
  for (let j = 0, n = 1 + rnd(5); j < n; j++) s += pick(["a", "b", "x", ".", "/", ".md", "-", "ab", "c"]);
  inputs.push(s);
}

const cases = [];
for (const pattern of patterns) {
  let source = null;
  let error = null;
  let matches = null;
  try {
    source = picomatch.makeRe(pattern, options).source;
    const match = picomatch(pattern, { dot: true });
    // One bit per input, as a string of 0 and 1.
    matches = inputs.map((input) => (match(input) ? "1" : "0")).join("");
  } catch (e) {
    error = `${e.name}: ${e.message}`;
  }
  cases.push({ pattern, source, error, matches });
}
writeFileSync(
  process.env.PICOMATCH_OUT ?? new URL("./fixtures/picomatch.json", import.meta.url),
  JSON.stringify({ version, inputs, cases }),
);
console.log(cases.length, "patterns,", inputs.length, "inputs,", cases.filter((c) => c.error).length, "errors");
