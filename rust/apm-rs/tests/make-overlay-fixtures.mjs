// Records apm-overlay.ts (inspectApmOverlay, collectSkillMdFiles), the overlay half of
// buildAuditInstallPlan, parseHooksJsonContent and skillMetadataFromDir for
// tests/overlay_fixtures.rs. Run from the repo root under Node (the CLI's runtime):
//   TZ=UTC node --import ./rust/apm-rs/tests/ts-resolve.mjs rust/apm-rs/tests/make-overlay-fixtures.mjs
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectSkillMdFiles, inspectApmOverlay } from "../../../src/services/apm-overlay.ts";
import { buildAuditInstallPlan } from "../../../src/services/apm-policy.ts";
import { parseHooksJsonContent } from "../../../src/services/hook-serialization.ts";
import { skillMetadataFromDir } from "../../../src/services/skill-auxiliary.ts";

if (process.env.TZ !== "UTC") throw new Error("run with TZ=UTC");

let seed = 0x0a9e17;
function rand() {
  seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0;
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 0x297a2d39);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const int = (n) => Math.floor(rand() * n);

function enc(v) {
  if (v === undefined) return { $undef: true };
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") return { $num: Object.is(v, -0) ? "-0" : String(v) };
  if (typeof v === "string") return v.toWellFormed();
  if (v instanceof Date) return { $date: String(v.getTime()) };
  if (Buffer.isBuffer(v)) return { $buf: [...v] };
  if (Array.isArray(v)) return v.map(enc);
  return { $obj: Object.keys(v).map((k) => [k, enc(v[k])]) };
}
const err = (e) => ({ name: e.name, message: e.name === "Error" ? "" : String(e.message) });

const frontmatters = [
  "", "---\n---\n", "---\nname: alpha\ndescription: First one\n---\n", "---\nname: '  spaced  '\n---\n", "---\nname: ''\n---\n", "---\nname: 5\ndescription: 7\n---\n",
  "---\nname: beta\ntools: [Read, Write]\nmodel: sonnet\n---\n", "---\ndescription: |\n  multi\n  line\n---\n", "---\napplyTo: '**/*.ts'\n---\n", "---\napplyTo: ['a/**', '', 3, ' b ']\n---\n",
  "---\napply_to: src/**\n---\n", "---\napplyTo: ~\napply_to: x/**\n---\n", "---\napplyTo: '   '\n---\n", "---\ncreated: 2024-01-01\nversion: 0x1F\n---\n", "---\nblob: !!binary SGk=\n---\n",
  "---\n!!binary SGk=\n---\n", "---\n- a\n- b\n---\n", "---\njust text\n---\n", "---\nname: dup\n---\n", "---\nname: dup\ndescription: second\n---\n", "\uFEFF---\nname: bom\n---\n", "---\r\nname: crlf\r\n---\r\n", "---json\n{\"name\": \"json-name\", \"x\": 1}\n---\n",
  "---\n__proto__: p\n2: two\n1: one\nname: keys\n---\n", "---\nname: \"\\u00e9t\\u00e9\"\n---\n", "---\n2001-12-14: d\n---\n", "---\nname: x\n---\n---\nmore\n",
];
const badFrontmatters = ["---\nname: [unclosed\n---\n", "---\ndescription: Search in three steps: search, timeline\n---\n", "---\nname: a\nname: b\n---\n"];
const bodies = ["", "Body text\n", "  \n  padded body  \n\n", "# Heading\n\nSome *markdown*.\n", "\n\n", "é😀\n"];
function markdown() {
  return pick(rand() < 0.03 ? badFrontmatters : frontmatters) + pick(bodies);
}
const hookDocs = [
  () => JSON.stringify({ hooks: { PreToolUse: [{ matcher: pick(["Bash", "Edit|Write", "", "a b/c", "😀x", "a  /b"]), hooks: [{ type: "command", command: pick(["echo hi", "./hooks/run.sh", "${CLAUDE_PLUGIN_ROOT}/x"]), timeout: pick([5, 1.5, "7", undefined]) }] }] } }),
  () => JSON.stringify({ hooks: { SessionStart: [{ command: "start", statusMessage: pick(["Starting", 5, undefined]), commandWindows: pick(["start.ps1", undefined, 3]) }, { command: 7 }, null, 3, [], { hooks: [{ command: "inner" }, { hooks: [{ command: "deep", matcher: "M" }] }] }] } }),
  () => JSON.stringify({ hooks: { b: [{ command: "b1" }, { command: "b2" }], a: [{ command: "a1" }], 2: [{ command: "two" }], 1: [{ command: "one" }] } }),
  () => '{"hooks":{"b":[{"command":"b1"}],"2":[{"command":"two"}],"a":[{"command":"a1"}],"1":[{"command":"one"}]}}',
  () => JSON.stringify({ hooks: { Stop: "nope", Pre: { command: "x" } } }),
  () => JSON.stringify({ hooks: [] }), () => JSON.stringify([]), () => "null", () => "{", () => "", () => "\uFEFF{\"hooks\":{}}",
  () => JSON.stringify({ version: 1, hooks: { E: [{ matcher: "same", command: "c1" }, { matcher: "same", command: "c2" }] } }),
  () => JSON.stringify({ hooks: { E: [{ command: "dup" }] } }), () => '{"hooks":{"E":[{"command":"x","command":"y","__proto__":{"command":"z"}}]}}',
  () => '{"hooks": {"E": [{"command": "n", "timeout": 1e2, "big": 12345678901234567890}]}}',
];
const companions = ["references/a.md", "reference/z.md", "scripts/run.sh", "scripts/b.py", "scripts/nested/deep.sh", "references/doc.md", "reference/doc.md", "reference/Other.md", "assets/img.png", "notes.txt", ".hidden", "scripts/.secret", "node_modules/x.js", "Z.md", "a.md", "_x.md"];

function buildTree() {
  const entries = [];
  const add = (path, kind, extra = {}) => entries.push({ path, kind, ...extra });
  const useApm = rand() < 0.65;
  const base = useApm ? ".apm/" : "";
  const kinds = ["skills", "agents", "commands", "hooks", ...(useApm ? ["instructions", "prompts", "chatmodes", "mcp"] : [])];
  for (const kind of kinds) {
    if (rand() < 0.45) continue;
    const dir = base + kind;
    const n = int(4);
    if (n === 0) add(dir, "dir");
    for (let i = 0; i < n; i++) {
      const sub = pick(["", "nested/", "deep/er/"]);
      if (kind === "skills") {
        const name = pick(["alpha", "beta", "gamma", "Δ", "dup"]);
        const file = rand() < 0.9 ? "SKILL.md" : pick(["skill.md", "Skill.MD", "README.md"]);
        const skillDir = rand() < 0.1 ? dir : `${dir}/${sub}${name}`;
        add(`${skillDir}/${file}`, "file", { content: markdown() });
        for (let c = int(4); c > 0; c--) add(`${skillDir}/${pick(companions)}`, "file", { content: "x", mode: pick([0o644, 0o755, 0o600]) });
      } else if (kind === "hooks") {
        add(`${dir}/${sub}${pick(["hooks", "pre", "Post.JSON", "x.json.bak", ".hidden", "a"])}${rand() < 0.8 ? ".json" : ""}`, "file", { content: pick(hookDocs)() });
      } else {
        const stem = pick(["review", "helper", "dup", "x.agent", "y.prompt", "z.instructions", "Mixed.AGENT", "plain"]);
        add(`${dir}/${sub}${stem}${pick([".md", ".md", ".MD", ".txt", ""])}`, "file", { content: markdown() });
      }
    }
  }
  if (useApm && rand() < 0.3) for (const d of ["agents", "skills", "commands", "hooks"]) if (rand() < 0.3) add(d, rand() < 0.8 ? "dir" : "file", { content: "" });
  if (useApm && rand() < 0.1) add(".apm/.keep", "file", { content: "" });
  if (useApm && rand() < 0.08) add(".apm/readme.txt", "file", { content: "" });
  if (useApm && entries.length === 0 && rand() < 0.5) add(".apm", "dir");
  if (rand() < 0.03) add(`${base}${pick(["skills", "agents", "hooks"])}/link`, "symlink", { target: "/tmp" });
  if (rand() < 0.03) add(`${base}agents`, "symlink", { target: "." });
  if (rand() < 0.02 && useApm) add(".apm-real", "dir"), add(".apm", "symlink", { target: ".apm-real" });
  if (rand() < 0.03) add(`${base}commands/.dot/x.md`, "file", { content: markdown() });
  if (rand() < 0.02) add(`${base}skills/broken`, "symlink", { target: "missing" });
  return entries;
}

function materialize(root, entries) {
  for (const e of entries) {
    const p = join(root, e.path);
    mkdirSync(dirname(p), { recursive: true });
    if (e.kind === "dir") mkdirSync(p, { recursive: true });
    else if (e.kind === "symlink") { try { symlinkSync(e.target, p); } catch {} }
    else if (e.kind === "fifo") execFileSync("mkfifo", [p]);
    else { try { writeFileSync(p, e.content); if (e.mode) chmodSync(p, e.mode); } catch {} }
  }
}

function encOverlay(o) {
  if (o === undefined) return null;
  return {
    present: o.present, fromApm: o.fromApm,
    skills: o.skills.map((s) => ({ name: s.name, description: s.description, content: s.content, skillDirRelative: s.skillDirRelative, skillMdRelative: s.skillMdRelative, metadata: enc(s.metadata) })),
    primitives: o.primitives.map((p) => ({ type: p.type, name: p.name, description: p.description, content: p.content, metadata: enc(p.metadata), sourceRelative: p.sourceRelative })),
    skippedKinds: o.skippedKinds, skippedRootDirs: o.skippedRootDirs, warnings: o.warnings,
  };
}

const special = [
  [{ path: ".apm/.keep", kind: "file", content: "" }],
  [{ path: ".apm/agents/top.md", kind: "file", content: "x" }, { path: ".apm/agents/sub/deep.md", kind: "file", content: "y" }],
  [{ path: ".apm/notes.txt", kind: "file", content: "" }, { path: ".apm/agents/a.md", kind: "file", content: "x" }, { path: ".apm/agents/b.md", kind: "file", content: "x" }],
  [{ path: ".apm/agents", kind: "dir" }],
  [{ path: ".apm/chatmodes", kind: "dir" }, { path: ".apm/mcp/x.json", kind: "file", content: "{}" }],
  [{ path: ".apm", kind: "symlink", target: "missing" }, { path: "agents/a.md", kind: "file", content: "x" }],
  [{ path: ".apm", kind: "symlink", target: "missing" }],
  [{ path: "skills", kind: "symlink", target: "missing" }],
  [{ path: "agents", kind: "file", content: "" }],
  [{ path: ".apm/skills", kind: "symlink", target: "missing" }, { path: ".apm/agents/a.md", kind: "file", content: "x" }],
  [{ path: ".apm/agents/pipe.md", kind: "fifo" }],
  [{ path: ".apm/skills/s/SKILL.md", kind: "file", content: "x" }, { path: ".apm/skills/s/references/a.md", kind: "file", content: "" }, { path: ".apm/skills/s/reference/z.md", kind: "file", content: "" }, { path: ".apm/skills/s/reference/a.md", kind: "file", content: "" }],
  [{ path: ".apm/skills/s/SKILL.md", kind: "file", content: "x" }, { path: ".apm/skills/s/sub", kind: "symlink", target: "../s" }],
  [{ path: ".apm/hooks/h.json", kind: "file", content: "{}" }, { path: ".apm/hooks/H.json", kind: "file", content: "[]" }],
];
const trees = [];
const scratch = mkdtempSync(join(tmpdir(), "overlay-rec-"));
for (let i = 0; i < 700; i++) {
  const entries = i < special.length ? special[i] : buildTree();
  const root = join(scratch, String(i));
  mkdirSync(root);
  materialize(root, entries);
  const specialExclude = { 1: [".apm/agents/*"], 2: [".apm/agents/a.md/**"] };
  const exclude = specialExclude[i] ?? (rand() < 0.2 ? [pick(["./.apm/agents/**", ".apm\\commands/*", ".apm/skills/alpha", "agents/**", "hooks/*", ".apm/instructions"])] : []);
  const rec = { entries, exclude };
  try { rec.overlay = encOverlay(inspectApmOverlay(root, { exclude })); } catch (e) { rec.overlayErr = err(e); }
  rec.skillMdDir = pick([".apm/skills", "skills", ".apm\\skills"]);
  try { rec.skillMd = collectSkillMdFiles(root, rec.skillMdDir).map((s) => [s.name, s.skillDirRelative, enc(s.metadata)]); } catch (e) { rec.skillMdErr = err(e); }
  rec.auditPrimitives = buildAuditInstallPlan({ projectRoot: root }).primitives;
  trees.push(rec);
}
rmSync(scratch, { recursive: true, force: true });

const hooks = [];
for (let i = 0; i < 400; i++) {
  const content = pick(hookDocs)();
  hooks.push({ content, resources: parseHooksJsonContent(content, "hooks/x.json").map((r) => ({ ...r, metadata: enc(r.metadata) })) });
}

const stats = { trees: trees.length, overlays: trees.filter((t) => t.overlay).length, none: trees.filter((t) => t.overlay === null).length, errors: trees.filter((t) => t.overlayErr).length, hooks: hooks.length };
writeFileSync(new URL("./fixtures/overlay.json", import.meta.url), JSON.stringify({ generator: "make-overlay-fixtures.mjs", stats, trees, hooks }) + "\n");
console.log(JSON.stringify(stats));
