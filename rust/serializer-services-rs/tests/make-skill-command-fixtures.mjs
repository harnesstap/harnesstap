// Records src/services/skill-command-metadata.ts for tests/skill_command_fixtures.rs:
// scanSkillCommandMetadataResources on generated skill trees, rebuilt by the Rust test in a
// temporary directory. Run from the repo root under Node:
//   node --experimental-transform-types --import ./rust/apm-rs/tests/ts-resolve.mjs rust/serializer-services-rs/tests/make-skill-command-fixtures.mjs
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scanSkillCommandMetadataResources } from "../../../src/services/skill-command-metadata.ts";

let seed = 0x5c111;
function rand() {
  seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0;
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 0x297a2d39);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const int = (n) => Math.floor(rand() * n);
const chance = (p) => rand() < p;

const KEYS = ["audit", "polish", "Zeta", "alpha", "é", "10", "2", " spaced ", "", "../escape", "a/b", "a\\b", "deep/../x", "__proto__", "Ölig", "z"];
const GOOD = ["Hello", "  padded  \n\n", "", "---\nname: x\n---\nBody here\n", "---\nname: x\n---\n", "é😀 text\n", "# Audit\n\nSteps.\n"];
const TEXTS = ["Hello", "  padded  \n\n", "", "---\nname: x\n---\nBody here\n", "---\nname: x\n---\n", "---\nname: x\nno close\n", "---\nname: [bad\n---\nbody\n", "---json\n{\"a\": 1}\n---\n json body ", "--- not frontmatter", "----\nx\n", "é😀 text\n"];
function entry() {
  const r = rand();
  if (r < 0.06) return pick([null, 3, "str", true, []]);
  const e = {};
  if (chance(0.7)) e.description = pick(["Do the thing", "  spaced  ", "", 5, null]);
  if (chance(0.5)) e.argumentHint = pick(["[file]", "  ", "", 1, null]);
  return e;
}
function metadataFile(keys) {
  const r = rand();
  if (r < 0.04) return pick(["", "{", "null", "[]", "3", "\"x\"", "{\"a\": 1,}"]);
  if (r < 0.06) return { dir: true };
  const o = {};
  for (const k of keys) o[k] = entry();
  return JSON.stringify(o, null, chance(0.5) ? 2 : 0);
}
function tree() {
  const entries = [];
  const keys = [...new Set(Array.from({ length: int(5) }, () => (chance(0.85) ? pick(KEYS.slice(0, 7)) : pick(KEYS))))];
  if (chance(0.95)) entries.push(["scripts/command-metadata.json", metadataFile(keys)]);
  for (const k of keys) {
    for (const dir of ["reference", "references"]) {
      if (chance(0.35)) entries.push([`${dir}/${k}.md`, chance(0.05) ? { dir: true } : chance(0.8) ? pick(GOOD) : pick(TEXTS)]);
    }
  }
  if (chance(0.1)) entries.push(["x.md", pick(TEXTS)]);
  return entries;
}

const base = mkdtempSync(join(tmpdir(), "skill-cmd-"));
const cases = [];
for (let i = 0; i < 500; i++) {
  // Keys with `..` can name the same file twice; the first one wins.
  const seen = new Set();
  const entries = tree().filter(([path]) => !seen.has(join("/", path)) && seen.add(join("/", path)));
  const root = join(base, String(i));
  const skillDir = join(root, "skill");
  mkdirSync(skillDir, { recursive: true });
  for (const [path, content] of entries) {
    const full = join(skillDir, path);
    if (typeof content === "object") {
      mkdirSync(full, { recursive: true });
    } else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
  const dirForm = pick(["", "/", "/./", "/../skill"]);
  const skillName = chance(0.9) ? pick(["my-skill", "Skill", "é", ""]) : pick([" ", "a/b", "a\\b"]);
  const importedFrom = chance(0.2) ? pick([{ plugin_name: "p", relative_path: "skills/x/scripts/command-metadata.json" }, { plugin_name: "p" }, { plugin_name: "p", relative_path: null }]) : undefined;
  const input = {
    skillDir: dirForm === "/" ? `${skillDir}/` : dirForm ? `${skillDir}${dirForm}` : skillDir,
    skillName,
    rootPath: root,
    relativePath: (rootPath, filePath) => `rel(${rootPath}|${filePath})`,
    importedFrom,
  };
  let out;
  try {
    out = { ok: scanSkillCommandMetadataResources(input) };
  } catch (e) {
    out = { err: `${e.name}: ${e.message}` };
  }
  const strip = (s) => JSON.parse(JSON.stringify(s).split(base).join("<BASE>"));
  cases.push({ entries, dirForm, skillName, importedFrom, out: strip(out) });
}
rmSync(base, { recursive: true, force: true });
mkdirSync(new URL("./fixtures/", import.meta.url), { recursive: true });
writeFileSync(new URL("./fixtures/skill-command-metadata.json", import.meta.url), `${JSON.stringify(cases)}\n`);
console.log(`skill-command-metadata ${cases.length}`);
