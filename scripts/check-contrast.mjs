#!/usr/bin/env node
// (d) Contrast check over design-tokens.json (port of the designer pairs.py).
// WCAG 2.x relative luminance. Text pairs need 4.5:1, UI boundaries and
// focus rings 3:1. "banned" pairs document recipes that must never ship;
// they are reported, and the check fails if one of them starts passing,
// which means a hex changed and the rule list needs a review.
// Usage: node ci/check-contrast.mjs [--tokens design-tokens.json] [--markdown] [--json]
import { readFileSync } from "node:fs";
import { parseArgs } from "./files.mjs";

export function luminance(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function pairs(tokens) {
  const S = tokens.shared;
  const out = [];
  for (const [theme, T] of Object.entries(tokens.themes)) {
    for (const bg of ["bg", "surface", "raised", "hover", "selected", "overlay"]) {
      for (const fg of ["fg", "muted", "link"]) out.push({ theme, name: `${fg} on ${bg}`, fg: T[fg], bg: T[bg], min: 4.5 });
    }
    for (const s of ["success", "warning", "danger", "info"]) {
      out.push({ theme, name: `${s}-fg on ${s}-bg`, fg: T[`${s}-fg`], bg: T[`${s}-bg`], min: 4.5 });
      for (const bg of ["surface", "raised"]) out.push({ theme, name: `${s}-fg on ${bg}`, fg: T[`${s}-fg`], bg: T[bg], min: 4.5 });
    }
    out.push({ theme, name: "link-hover on bg", fg: T["link-hover"], bg: T.bg, min: 4.5 });
    for (const bg of ["bg", "surface"]) {
      out.push({ theme, name: `border-control on ${bg} (UI)`, fg: T["border-control"], bg: T[bg], min: 3 });
      out.push({ theme, name: `focus ring on ${bg} (UI)`, fg: S["action-primary-ring"], bg: T[bg], min: 3 });
    }
    for (const bg of ["bg", "surface", "raised"]) out.push({ theme, name: `action fill vs ${bg} (UI)`, fg: S["action-primary"], bg: T[bg], min: 3 });
    out.push({ theme, name: "in-use mark on surface (UI)", fg: T.inuse, bg: T.surface, min: 3 });
  }
  const sh = (name, fg, bg, min = 4.5) => out.push({ theme: "shared", name, fg, bg, min });
  sh("action-fg on action-primary", S["action-primary-fg"], S["action-primary"]);
  sh("action-fg on action-primary-hover", S["action-primary-fg"], S["action-primary-hover"]);
  sh("white on violet-fill", S["action-primary-fg"], S["violet-fill"]);
  sh("success-fill-fg on success-fill", S["success-fill-fg"], S["success-fill"]);
  sh("danger-fill-fg on danger-fill", S["danger-fill-fg"], S["danger-fill"]);
  sh("danger-fill-fg on danger-fill-hover", S["danger-fill-fg"], S["danger-fill-hover"]);
  sh("brand-ink on brand-warn", S["brand-ink"], S["brand-warn"]);
  const ban = (name, fg, bg, min = 4.5) => out.push({ theme: "banned", name, fg, bg, min, banned: true });
  ban("white on brand-blue (use action-primary)", "#FFFFFF", S["brand-blue"]);
  ban("white on brand-teal (use success-fill)", "#FFFFFF", S["brand-teal"]);
  ban("white on brand-violet (use violet-fill)", "#FFFFFF", S["brand-violet"]);
  ban("white on brand-danger (use danger-fill)", "#FFFFFF", S["brand-danger"]);
  ban("action-primary as text on dark bg (use link)", S["action-primary"], tokens.themes.dark.bg);
  ban("brand-blue as text on dark raised (use link)", S["brand-blue"], tokens.themes.dark.raised);
  ban("brand-danger as text on dark raised (use danger-fg)", S["brand-danger"], tokens.themes.dark.raised);
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2), { tokens: "design-tokens.json", markdown: false, json: false });
  const tokens = JSON.parse(readFileSync(args.tokens, "utf8"));
  const rows = pairs(tokens).map((p) => {
    if (!p.fg || !p.bg) return { ...p, ratio: 0, ok: false, error: "token missing" };
    const r = ratio(p.fg, p.bg);
    const passes = r >= p.min;
    return { ...p, ratio: Number(r.toFixed(2)), ok: p.banned ? !passes : passes };
  });
  const failures = rows.filter((r) => !r.ok);
  if (args.json) console.log(JSON.stringify(rows, null, 2));
  else if (args.markdown) {
    console.log("| Theme | Pair | Fg | Bg | Ratio | Min | Result |\n|---|---|---|---|---:|---:|---|");
    for (const r of rows) console.log(`| ${r.theme} | ${r.name} | \`${r.fg}\` | \`${r.bg}\` | ${r.ratio.toFixed(2)} | ${r.min} | ${r.banned ? (r.ok ? "Banned, fails as expected" : "Banned pair now passes, review") : r.ok ? "Pass" : "Fail"} |`);
  } else {
    for (const r of failures) console.error(`${r.banned ? "review" : "fail"}  [${r.theme}] ${r.name}: ${r.fg} on ${r.bg} = ${r.ratio.toFixed(2)} (min ${r.min})${r.error ? ` ${r.error}` : ""}`);
    console.error(`${rows.length} pairs checked, ${failures.length} problem(s).`);
  }
  process.exit(failures.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
