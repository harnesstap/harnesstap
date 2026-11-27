// Records the reading half of apm-manifest.ts (parseApmYamlDocument, extractApmManifestFields,
// parseApmManifestContents, readPackageRuntimeApmDependencies) and apm-mcp-manifest.ts for
// tests/manifest_fixtures.rs. Overlay roots reuse the trees in fixtures/overlay.json. Run from
// the repo root under Node (the CLI's runtime):
//   TZ=UTC node --experimental-transform-types --import ./rust/apm-rs/tests/ts-resolve.mjs rust/apm-rs/tests/make-manifest-fixtures.mjs
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { parseApmManifestContents, readPackageRuntimeApmDependencies } from "../../../src/services/apm-manifest.ts";
import { appendMcpRegistryIdToManifest, manifestHasMcpRegistryId, withMcpManifestAppend } from "../../../src/services/apm-mcp-manifest.ts";

if (process.env.TZ !== "UTC") throw new Error("run with TZ=UTC");

let seed = 0x3a71f;
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
let currentRoot = "\0";
const scrub = (s) => s.split(currentRoot).join("<root>");
const err = (e) => ({ name: e.name, message: scrub(String(e.message)) });

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
  return {
    present: o.present, fromApm: o.fromApm,
    skills: o.skills.map((s) => ({ name: s.name, description: s.description, content: s.content, skillDirRelative: s.skillDirRelative, skillMdRelative: s.skillMdRelative, metadata: enc(s.metadata) })),
    primitives: o.primitives.map((p) => ({ type: p.type, name: p.name, description: p.description, content: p.content, metadata: enc(p.metadata), sourceRelative: p.sourceRelative })),
    skippedKinds: o.skippedKinds, skippedRootDirs: o.skippedRootDirs, warnings: o.warnings,
  };
}
function encFields(f) {
  const out = { name: f.name, version: f.version };
  if ("description" in f) out.description = f.description;
  out.vendor = enc(f.vendor);
  out.harnessTargets = f.harnessTargets; out.skippedTargets = f.skippedTargets;
  out.apmDependencies = JSON.parse(JSON.stringify(f.apmDependencies));
  out.mcpDependencies = JSON.parse(JSON.stringify(f.mcpDependencies));
  if ("policyPin" in f) out.policyPin = f.policyPin;
  if ("overlay" in f) out.overlay = encOverlay(f.overlay);
  if ("compilation" in f) out.compilation = enc(f.compilation);
  out.warnings = f.warnings; out.rest = enc(f.rest);
  return out;
}

const scalars = ["demo", 5, true, false, "  ", "", "  padded  ", 1.5, 1e21, -0, null, ["a"], { a: 1 }, 0.1, "é😀"];
const targetTokens = ["copilot", "claude", "cursor", "codex", "gemini", "all", "vscode", "Agents", "claude-code", "x-acme-tool", "unknown", "", " Claude ", "kiro", "windsurf"];
const tokenValue = () => pick([
  () => pick(targetTokens), () => Array.from({ length: int(4) }, () => pick(targetTokens)),
  () => Array.from({ length: 1 + int(3) }, () => pick(targetTokens)).join(pick([",", ", ", " "])), () => 5, () => null, () => [3, "claude"],
])();
const depStrings = ["acme/repo", "acme/repo#v1.2.0", "./local", "../up", "https://github.com/acme/r.git", "git@github.com:acme/r.git#main", "pkg@market", "", " ", "acme/repo/sub/path", "~/home/pkg", "/abs/pkg"];
const apmDep = () => rand() < 0.75 ? pick(depStrings) : pick([
  () => pick(depStrings), () => ({ git: pick(depStrings), ref: pick(["main", undefined, 3]) }), () => ({ path: pick(["./p", "../q", ""]) }),
  () => ({ id: "acme/x", git: "acme/y" }), () => ({ marketplace: "m", name: "n" }), () => ({ other: 1 }), () => 7, () => ({ id: pick(["acme/x", "x@1.0.0"]) }),
])();
const mcpIds = ["io.github.acme/server", "io.github.acme/server@1.2.0", "acme-server", "acme-server@latest", "@scope/pkg", "@scope/pkg@2", "a/b@", " spaced ", "x@y/z", "@", ""];
const mcpDep = () => rand() < 0.7 ? pick(mcpIds) : pick([
  () => pick(mcpIds), () => ({ name: pick(mcpIds), transport: pick(["stdio", "http", "sse", undefined]), command: pick(["npx", undefined]), args: pick([["-y", "x"], undefined]) }),
  () => ({ name: "local", registry: false, command: "node", env: { B: "1", A: "2", 2: "two" } }), () => ({ url: "https://x" }), () => 3,
])();
const list = (gen) => Array.from({ length: int(4) }, gen);
const pins = [{ hash: "sha256:AB12" }, { hash: "abc", hash_algorithm: "sha512" }, { hash: 5 }, "x", { hash: "md5:x" }, {}, null, { hash: " sha256:y ", hash_algorithm: "SHA384" }];

function buildDocument() {
  const doc = {};
  const maybe = (p, key, gen) => { if (rand() < p) doc[key] = gen(); };
  const order = [
    () => maybe(0.97, "name", () => rand() < 0.88 ? pick(["demo", "acme-pkg", "  trimmed  "]) : pick(scalars)),
    () => maybe(0.97, "version", () => rand() < 0.88 ? pick(["1.0.0", "0.1.0", " 2.0 "]) : pick(scalars)),
    () => maybe(0.5, "description", () => pick(scalars)),
    () => maybe(0.1, "workspaces", () => pick([["a"], null, "x"])),
    () => maybe(0.3, "target", tokenValue),
    () => maybe(0.15, "targets", tokenValue),
    () => maybe(0.3, "compilation", () => {
      if (rand() < 0.1) return pick(["x", 3, null, []]);
      const c = {};
      if (rand() < 0.5) c.target = tokenValue();
      if (rand() < 0.2) c.targets = tokenValue();
      if (rand() < 0.4) c.strategy = pick(["distributed", "single-file", 3, "Distributed"]);
      if (rand() < 0.3) c.source_attribution = pick([true, false, "true", 1]);
      if (rand() < 0.4) c.exclude = pick([["./.apm/agents/**", 3, "hooks/*"], ".apm/skills/alpha", 5, [], ["agents/**"]]);
      if (rand() < 0.2) c.chatmode = pick(["review", 3, ""]);
      if (rand() < 0.2) c.single_file = pick([true, false, "true", 1]);
      return c;
    }),
    () => maybe(0.6, "dependencies", () => {
      if (rand() < 0.05) return pick(["x", [], null]);
      const d = {};
      if (rand() < 0.8) d.apm = rand() < 0.05 ? pick(["acme/x", 3, {}]) : list(apmDep);
      if (rand() < 0.6) d.mcp = rand() < 0.05 ? pick(["acme/x", 3, {}]) : list(mcpDep);
      return d;
    }),
    () => maybe(0.2, "devDependencies", () => ({ apm: list(apmDep), ...(rand() < 0.5 ? { mcp: list(mcpDep) } : {}) })),
    () => maybe(0.2, "policy", () => pick(pins)),
    () => maybe(0.3, "default_profile", () => pick(["dev", null, 3])),
    () => maybe(0.2, "environments", () => ({ dev: { plugins: ["a"] } })),
    () => maybe(0.2, "profiles", () => pick([{ p: {} }, null])),
    () => maybe(0.2, "plugins", () => pick([["a", "b"], {}])),
    () => maybe(0.2, "x-harnesstap", () => ({ v: 1 })),
    () => maybe(0.1, "default_environment", () => "dev"),
    () => maybe(0.1, "environment", () => "dev"),
    () => maybe(0.3, pick(["scripts", "license", "author", "2", "1", "x-other", "__x"]), () => pick(scalars)),
    () => maybe(0.2, "type", () => pick(["skill", "hybrid"])),
  ];
  if (rand() < 0.3) order.sort(() => rand() - 0.5);
  for (const f of order) f();
  return doc;
}
const rawDocs = [
  "", "~", "- a\n- b\n", "just text\n", "name: [unclosed\n", "name: a\nname: b\n", "name: demo\nversion: 1.0.0\n", "name: demo\r\nversion: 1.0.0\r\ndescription: crlf\r\n",
  "name: &n demo\nversion: *n\n", "name: demo\nversion: 1.0.0\n---\nname: two\n", "name: demo\nversion: 1.0.0\nrest: !!binary SGk=\n", "name: demo\nversion: 1.0.0\n2: two\n1: one\nz: last\n",
  "name: demo\nversion: 1.0.0\ndescription: |\n  multi\n  line\n", "name: 0x1F\nversion: 1e3\n", "name: demo\nversion: 1.0.0\nwhen: 2024-01-01\n", "\uFEFFname: bom\nversion: 1.0.0\n",
  "name: demo\nversion: 1.0.0\ntarget: claude\ncompilation:\n  target: codex\n  strategy: distributed\n", "name: demo\nversion: 1.0.0\nx: -0\ny: .nan\nz: .inf\n",
  "name: demo\nversion: 1.0.0\n? [a, b]\n: complex\n", "name: demo\nversion: 1.0.0\n<<: {merged: 1}\n", "name: demo\nversion: 1.0.0\n__proto__: p\n",
];

const overlayTrees = JSON.parse(readFileSync(new URL("./fixtures/overlay.json", import.meta.url), "utf8")).trees.map((t) => t.entries);
const scratch = mkdtempSync(join(tmpdir(), "manifest-rec-"));

const manifests = [];
for (let i = 0; i < 1500; i++) {
  const raw = i < rawDocs.length ? rawDocs[i] : stringifyYaml(buildDocument(), { indent: 2, lineWidth: 0, defaultKeyType: "PLAIN" });
  const filePath = pick(["apm.yml", "/x/proj/apm.yml"]);
  const tree = rand() < 0.15 ? int(120) : null;
  const rec = { raw, filePath, tree };
  let root;
  if (tree !== null) {
    root = join(scratch, `m${i}`);
    mkdirSync(root);
    materialize(root, overlayTrees[tree]);
    currentRoot = root;
  } else currentRoot = "\0";
  try { rec.fields = encFields(parseApmManifestContents(raw, filePath, root)); } catch (e) { rec.err = err(e); }
  manifests.push(rec);
}

const packages = [];
for (let i = 0; i < 120; i++) {
  const root = join(scratch, `p${i}`);
  mkdirSync(root);
  currentRoot = root;
  const kind = i < 3 ? ["missing", "symlink", "dir"][i] : rand() < 0.05 ? "missing" : "file";
  const raw = kind === "file" ? (rand() < 0.1 ? pick(rawDocs) : stringifyYaml(buildDocument(), { indent: 2, lineWidth: 0 })) : null;
  if (kind === "symlink") { writeFileSync(join(root, "real.yml"), "name: x\n"); symlinkSync("real.yml", join(root, "apm.yml")); }
  if (kind === "dir") mkdirSync(join(root, "apm.yml"));
  if (raw !== null) writeFileSync(join(root, "apm.yml"), raw);
  const rec = { kind, raw };
  try { rec.deps = JSON.parse(JSON.stringify(readPackageRuntimeApmDependencies(root))); } catch (e) { rec.err = err(e); }
  packages.push(rec);
}
currentRoot = "\0";

const mcpSpecial = [
  ["name: d\nversion: 1\ndependencies:\n  mcp:\n    - name: acme-server\n", "acme-server@1.2.0"],
  ["name: d\nversion: 1\ndependencies:\n  mcp:\n    - name: acme-server\n      registry: acme-server\n", "acme-server@2"],
  ["name: d\nversion: 1\ndependencies:\n  mcp:\n    - name: acme-server\n      registry: false\n", "acme-server@2"],
  ["name: d\nversion: 1\ndevDependencies:\n  mcp:\n    - acme-server\n", "acme-server@2"],
  ["name: d\nversion: 1\ndependencies:\n  mcp: x\n", "acme-server"],
  ["name: d\nversion: 1\ndependencies: [a]\n", "acme-server"],
  ["name: d\nversion: 1\ndependencies:\n  apm: [acme/x]\n  mcp: []\n  z: 1\n", "acme-server"],
];
const mcp = [];
for (let i = 0; i < 800; i++) {
  const special = i >= rawDocs.length ? mcpSpecial[i - rawDocs.length] : undefined;
  const raw = special ? special[0] : i < rawDocs.length ? rawDocs[i] : stringifyYaml(buildDocument(), { indent: 2, lineWidth: 0, defaultKeyType: "PLAIN" });
  const registryId = special ? special[1] : rand() < 0.8 ? pick(mcpIds) : pick(["io.github.acme/other@3", "new-server", "acme/repo"]);
  const rec = { raw, registryId };
  try { rec.has = manifestHasMcpRegistryId(raw, registryId); } catch (e) { rec.hasErr = err(e); }
  try { const r = appendMcpRegistryIdToManifest(raw, registryId); rec.next = r.next; rec.added = r.added; } catch (e) { rec.appendErr = err(e); }
  mcp.push(rec);
}

const appendRuns = [];
const scenarios = [
  { file: null, exitCode: 0, dryRun: false, throws: false },
  { file: "name: demo\nversion: 1.0.0\n", exitCode: 0, dryRun: false, throws: false },
  { file: "name: demo\nversion: 1.0.0\n", exitCode: 1, dryRun: false, throws: false },
  { file: "name: demo\nversion: 1.0.0\n", exitCode: 0, dryRun: true, throws: false },
  { file: "name: demo\nversion: 1.0.0\n", exitCode: 0, dryRun: false, throws: true },
  { file: "name: demo\nversion: 1.0.0\ndependencies:\n  mcp: [new-server]\n", exitCode: 0, dryRun: false, throws: false },
  { file: "name: demo\nversion: 1.0.0\ndependencies:\n  mcp: [new-server]\n", exitCode: 1, dryRun: true, throws: true },
  { file: "- not a mapping\n", exitCode: 0, dryRun: false, throws: false },
];
for (const [i, s] of scenarios.entries()) {
  const root = join(scratch, `a${i}`);
  mkdirSync(root);
  currentRoot = root;
  if (s.file !== null) writeFileSync(join(root, "apm.yml"), s.file);
  const rec = { ...s };
  let during = null;
  try {
    const r = await withMcpManifestAppend({
      projectRoot: root, registryId: "new-server", dryRun: s.dryRun,
      run: async () => { during = readFileSync(join(root, "apm.yml"), "utf8"); process.exitCode = s.exitCode; if (s.throws) throw new Error("boom"); },
    });
    rec.added = r.added;
  } catch (e) { rec.err = err(e); }
  process.exitCode = 0;
  rec.during = during;
  try { rec.after = readFileSync(join(root, "apm.yml"), "utf8"); } catch { rec.after = null; }
  appendRuns.push(rec);
}
rmSync(scratch, { recursive: true, force: true });

const stats = { manifests: manifests.length, ok: manifests.filter((m) => m.fields).length, withOverlay: manifests.filter((m) => m.fields?.overlay).length, packages: packages.length, mcp: mcp.length, added: mcp.filter((m) => m.added).length, appendRuns: appendRuns.length };
writeFileSync(new URL("./fixtures/manifest.json", import.meta.url), JSON.stringify({ generator: "make-manifest-fixtures.mjs", stats, manifests, packages, mcp, appendRuns }) + "\n");
console.log(JSON.stringify(stats));
