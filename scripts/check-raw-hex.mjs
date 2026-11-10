#!/usr/bin/env node
// (a) Raw color lint: fail on hex colors and numeric rgb()/hsl() literals
// outside the token files. Usage:
//   node ci/check-raw-hex.mjs [--root .] [--path apps/desktop/src --path src]
//     [--allow tokens.css ...] [--ignore test/ ...] [--allowlist ci/raw-hex-allowlist.txt]
//     [--changed-since origin/main] [--json]
// Inline escape hatch (needs a reason in review): a line containing
// "token-lint: allow" is skipped.
import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { classify, kindOf, lineCol, COMMENT, STRING } from "./lex.mjs";
import { changedLines, matchesAny, parseArgs, readAllowlist, rel, walk } from "./files.mjs";

const EXTS = new Set([".css", ".scss", ".pcss", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".html", ".vue", ".svelte"]);
const DEFAULT_ALLOW = ["design-tokens.json", "tokens.css", "tokens.ts", "theme.ts"];
const DEFAULT_IGNORE = ["test/", "tests/", "e2e/", "__tests__/", "fixtures/", "*.test.ts", "*.test.tsx", "*.spec.ts", "*.spec.tsx", "*.stories.tsx", "*.d.ts"];
const HEX = /(?<![\w&.#\-$\/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w\-])/g;
const COLOR_FN = /\b(?:rgba?|hsla?)\(\s*[\d.]/g;
const INLINE_ALLOW = "token-lint: allow";

export function findRawColors(text, ext) {
  const kinds = classify(text, ext);
  const isJs = kindOf(ext) === "js";
  const hits = [];
  for (const re of [HEX, COLOR_FN]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const k = kinds[m.index];
      if (k === COMMENT) continue;
      // In JS/TS a color is always a string; this skips private #fields.
      if (isJs && k !== STRING) continue;
      hits.push({ index: m.index, match: m[0] });
    }
  }
  const lines = text.split("\n");
  return hits
    .map((h) => ({ ...lineCol(text, h.index), match: h.match }))
    .filter((h) => !lines[h.line - 1].includes(INLINE_ALLOW))
    .sort((a, b) => a.line - b.line || a.column - b.column);
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    root: ".", path: [], allow: [], ignore: [], allowlist: "", "changed-since": "", json: false, "no-defaults": false,
  });
  const root = resolve(args.root);
  const roots = args.path.length ? args.path : ["."];
  const allow = args["no-defaults"] ? args.allow : [...DEFAULT_ALLOW, ...args.allow];
  const ignore = args["no-defaults"] ? args.ignore : [...DEFAULT_IGNORE, ...args.ignore];
  const allowlist = readAllowlist(args.allowlist && resolve(root, args.allowlist));
  const changed = changedLines(root, args["changed-since"]);
  const violations = [];
  for (const p of roots) {
    for (const file of walk(join(root, p), EXTS)) {
      const r = rel(root, file);
      if (matchesAny(r, allow) || matchesAny(r, ignore)) continue;
      const only = changed ? changed.get(r) : null;
      if (changed && !only) continue;
      for (const h of findRawColors(readFileSync(file, "utf8"), extname(file).toLowerCase())) {
        if (only && !only.has(h.line)) continue;
        if (allowlist.has(`${r}:${h.line}`)) continue;
        violations.push({ file: r, ...h });
      }
    }
  }
  if (args.json) console.log(JSON.stringify(violations, null, 2));
  else {
    for (const v of violations) console.error(`${v.file}:${v.line}:${v.column}  raw color ${v.match}  use a token`);
    console.error(violations.length ? `\n${violations.length} raw color literal(s). Use a design token, or add the hex to the token files first.` : "Raw color lint: clean.");
  }
  process.exit(violations.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (e) {
    console.error(`check-raw-hex: ${e.message.split("\n")[0]}`);
    console.error("With --changed-since, fetch the base ref first (for example: git fetch origin main).");
    process.exit(2);
  }
}
