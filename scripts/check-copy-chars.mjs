#!/usr/bin/env node
// (b) Copy lint: fail on U+2014 (em dash), U+2013 (en dash) and U+2026
// (ellipsis) in user-facing text. Code comments are exempt. Usage:
//   node ci/check-copy-chars.mjs [--root .] [--path src --path docs --path README.md]
//     [--ignore test/ ...] [--allowlist scripts/copy-allowlist.txt]
//     [--changed-since origin/main] [--json]
// Allowlist lines are "relative/path:line:column", expected to stay empty.
import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { classify, lineCol, COMMENT } from "./lex.mjs";
import { changedLines, matchesAny, parseArgs, readAllowlist, rel, walk } from "./files.mjs";

export const BANNED = [
  { char: "\u2014", name: "em dash (U+2014)", fix: "use a period, comma, colon or parentheses" },
  { char: "\u2013", name: "en dash (U+2013)", fix: "use 'to' for ranges, or a hyphen" },
  { char: "\u2026", name: "ellipsis (U+2026)", fix: "use three periods (...)" },
];
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".html", ".vue", ".svelte", ".md", ".mdx", ".mdc", ".json", ".yml", ".yaml", ".txt"]);
const DEFAULT_IGNORE = ["test/", "tests/", "__tests__/", "fixtures/", "*.test.ts", "*.test.tsx", "*.spec.ts", "CHANGELOG.md", "package-lock.json", "bun.lock"];

export function findBannedChars(text, ext) {
  const kinds = classify(text, ext);
  const hits = [];
  for (let i = 0; i < text.length; i++) {
    const b = BANNED.find((x) => x.char === text[i]);
    if (!b || kinds[i] === COMMENT) continue;
    hits.push({ ...lineCol(text, i), name: b.name, fix: b.fix });
  }
  return hits;
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    root: ".", path: [], ignore: [], allowlist: "", "changed-since": "", json: false,
  });
  const root = resolve(args.root);
  const roots = args.path.length ? args.path : ["."];
  const ignore = [...DEFAULT_IGNORE, ...args.ignore];
  const allowlist = readAllowlist(args.allowlist && resolve(root, args.allowlist));
  const changed = changedLines(root, args["changed-since"]);
  const violations = [];
  for (const p of roots) {
    for (const file of walk(join(root, p), EXTS)) {
      const r = rel(root, file);
      if (matchesAny(r, ignore)) continue;
      const only = changed ? changed.get(r) : null;
      if (changed && !only) continue;
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      for (const h of findBannedChars(text, extname(file).toLowerCase())) {
        if (only && !only.has(h.line)) continue;
        if (allowlist.has(`${r}:${h.line}:${h.column}`)) continue;
        violations.push({ file: r, ...h, text: lines[h.line - 1].trim().slice(0, 120) });
      }
    }
  }
  if (args.json) console.log(JSON.stringify(violations, null, 2));
  else {
    for (const v of violations) console.error(`${v.file}:${v.line}:${v.column}  ${v.name}: ${v.fix}\n    ${v.text}`);
    console.error(violations.length ? `\n${violations.length} banned character(s) in user-facing text.` : "Copy character lint: clean.");
  }
  process.exit(violations.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
