#!/usr/bin/env node
// (c) Token drift check. Two modes, combinable:
//   1. --snapshot <file|https-url>: the shared, themes and registers sections of
//      --tokens must equal the snapshot (the other repo's copy). Any difference fails.
//   2. --css <file>: every token declared as a hex in that CSS file must match
//      design-tokens.json for the theme of its block. Mismatch fails; a token
//      the CSS does not declare yet is a warning (or a failure with --strict).
// Usage:
//   node ci/check-token-drift.mjs --tokens design-tokens.json \
//     [--snapshot ci/design-tokens.snapshot.json] [--css apps/desktop/src/styles/tokens.css] [--strict] [--json]
import { readFileSync } from "node:fs";
import { classify, COMMENT } from "./lex.mjs";
import { parseArgs } from "./files.mjs";

const COMPARED = ["shared", "themes", "registers"];

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (k.startsWith("$")) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = typeof v === "string" ? v.toUpperCase() : v;
  }
  return out;
}

export function diffSnapshots(tokens, snapshot) {
  const a = flatten(Object.fromEntries(COMPARED.map((k) => [k, tokens[k]])));
  const b = flatten(Object.fromEntries(COMPARED.map((k) => [k, snapshot[k]])));
  const problems = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(key in a)) problems.push({ key, kind: "missing here", snapshot: b[key] });
    else if (!(key in b)) problems.push({ key, kind: "missing in snapshot", here: a[key] });
    else if (a[key] !== b[key]) problems.push({ key, kind: "value differs", here: a[key], snapshot: b[key] });
  }
  return problems.sort((x, y) => x.key.localeCompare(y.key));
}

// Parse "selector { --name: value; }" blocks, ignoring comments.
export function parseCssBlocks(css) {
  const kinds = classify(css, ".css");
  const clean = [...css].map((ch, i) => (kinds[i] === COMMENT ? " " : ch)).join("");
  const blocks = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) {
    const vars = {};
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) vars[d[1]] = d[2].trim();
    blocks.push({ selector: m[1].trim(), vars });
  }
  return blocks;
}

export function themeOf(selector, rootTheme) {
  const s = selector.toLowerCase();
  if (/dark/.test(s)) return "dark";
  if (/light/.test(s)) return "light";
  if (/:root|html/.test(s)) return rootTheme;
  return null;
}

export function checkCss(tokens, css) {
  const rootTheme = tokens.cssRootTheme ?? "light";
  const map = tokens.cssVars ?? {};
  const varFor = (name) => map[name] ?? `--${name}`;
  const blocks = parseCssBlocks(css);
  const declared = { dark: {}, light: {} };
  const own = { dark: false, light: false };
  const rootVars = {};
  for (const b of blocks) {
    const t = themeOf(b.selector, rootTheme);
    if (!t) continue;
    const plainRoot = /:root|html/i.test(b.selector) && !/dark|light/i.test(b.selector);
    if (plainRoot) Object.assign(rootVars, b.vars);
    else own[t] = true;
    Object.assign(declared[t], b.vars);
  }
  // Plain :root values cascade into the other theme when that theme has its
  // own block and does not override them (a light block that forgets --surface
  // really does render the dark surface).
  const other = rootTheme === "dark" ? "light" : "dark";
  if (own[other]) for (const [k, v] of Object.entries(rootVars)) if (!(k in declared[other])) declared[other][k] = v;
  const resolve = (vars, value, depth = 0) => {
    const ref = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(value ?? "");
    if (ref && depth < 8) return resolve(vars, vars[ref[1]], depth + 1);
    return value;
  };
  const isHex = (v) => typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v);
  const results = [];
  const expect = (scope, theme, name, want) => {
    const cssVar = varFor(name);
    const got = resolve(declared[theme], declared[theme][cssVar]);
    if (got === undefined) results.push({ level: "warn", key: `${scope}.${name}`, theme, cssVar, want, got: null });
    else if (!isHex(got)) results.push({ level: "info", key: `${scope}.${name}`, theme, cssVar, want, got });
    else if (got.toUpperCase() !== want.toUpperCase()) results.push({ level: "error", key: `${scope}.${name}`, theme, cssVar, want, got });
  };
  const themesInCss = ["dark", "light"].filter((t) => Object.keys(declared[t]).length);
  for (const theme of themesInCss) {
    for (const [name, want] of Object.entries(tokens.shared)) expect("shared", theme, name, want);
    for (const [name, want] of Object.entries(tokens.themes[theme])) expect(`themes.${theme}`, theme, name, want);
  }
  return results;
}

async function load(src) {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Could not fetch ${src}: ${res.status}`);
    return res.json();
  }
  return JSON.parse(readFileSync(src, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { tokens: "design-tokens.json", snapshot: "", css: [], strict: false, json: false });
  const tokens = await load(args.tokens);
  let failed = false;
  const report = {};
  if (args.snapshot) {
    const problems = diffSnapshots(tokens, await load(args.snapshot));
    report.snapshot = problems;
    if (problems.length) failed = true;
    if (!args.json) {
      for (const p of problems) console.error(`drift  ${p.key}: ${p.kind} (here ${p.here ?? "none"}, snapshot ${p.snapshot ?? "none"})`);
      console.error(problems.length ? `${problems.length} token(s) drifted from ${args.snapshot}.` : `Tokens match ${args.snapshot}.`);
    }
  }
  for (const file of args.css) {
    const results = checkCss(tokens, readFileSync(file, "utf8"));
    report[file] = results;
    const errors = results.filter((r) => r.level === "error");
    const warns = results.filter((r) => r.level === "warn");
    if (errors.length || (args.strict && warns.length)) failed = true;
    if (!args.json) {
      for (const r of errors) console.error(`error  ${file} [${r.theme}] ${r.cssVar} is ${r.got}, tokens say ${r.want} (${r.key})`);
      for (const r of warns) console.error(`warn   ${file} [${r.theme}] ${r.cssVar} not declared (${r.key} ${r.want})`);
      console.error(`${file}: ${errors.length} mismatch(es), ${warns.length} not declared yet.`);
    }
  }
  if (args.json) console.log(JSON.stringify(report, null, 2));
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(2); });
