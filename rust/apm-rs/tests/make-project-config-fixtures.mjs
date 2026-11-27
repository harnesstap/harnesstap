// Records project-config.ts for tests/project_config_fixtures.rs: parseProjectConfigContents,
// validateProjectConfig, evaluateProjectConfigContents, getProfileEntry and
// resolveProfileEnvironment on generated manifests, and findProjectConfig,
// locateProjectManifest and mergeProjectConfigLocalOverrides on generated project trees. Run
// from the repo root under Node (the CLI's runtime):
//   TZ=UTC node --experimental-transform-types --import ./rust/apm-rs/tests/ts-resolve.mjs rust/apm-rs/tests/make-project-config-fixtures.mjs
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import * as pc from "../../../src/services/project-config.ts";

if (process.env.TZ !== "UTC") throw new Error("run with TZ=UTC");

let seed = 0x5c0f19;
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
  if (Array.isArray(v)) return v.map(enc);
  return { $obj: Object.keys(v).map((k) => [k, enc(v[k])]) };
}
let currentRoot = "\0";
const scrub = (s) => s.split(currentRoot).join("<root>");
const err = (e) => ({ name: e.name, message: scrub(String(e.message)) });

function encConfig(c) {
  const out = {};
  for (const k of ["default_profile", "default_environment", "apm_name", "apm_version", "apm_description"]) if (k in c) out[k] = c[k];
  out.profiles = c.profiles.map((p) => ({ ...p }));
  out.environments = c.environments.map((e) => ({
    name: e.name, values: enc(e.values),
    ...("secret_refs" in e ? { secret_refs: { $obj: Object.keys(e.secret_refs).map((k) => [k, e.secret_refs[k]]) } } : {}),
  }));
  out.plugins = c.plugins.map(enc);
  if ("apm_document" in c) out.apm_document = enc(c.apm_document);
  return out;
}

const scalars = ["dev", "", 3, true, null, ["a", null, 2], { a: 1 }, 1.5, "é😀", "prod"];
const profileNames = ["dev", "prod", "ci", "dev"];
function profile() {
  if (rand() < 0.04) return pick(["x", 3, null, []]);
  const p = {};
  if (rand() < 0.95) p.name = rand() < 0.96 ? pick(profileNames) : pick(scalars);
  if (rand() < 0.95) p.source = rand() < 0.95 ? pick(["catalog", "local", "inline"]) : pick(["remote", 3, "", null]);
  if (rand() < 0.6) p.selector = rand() < 0.8 ? pick(["acme/x@1", "local-sel"]) : pick(["", 3]);
  if (rand() < 0.5) p.plugin = rand() < 0.8 ? pick(["inline-a", "inline-b", "missing"]) : pick(["", 3]);
  if (rand() < 0.4) p.environment = rand() < 0.8 ? pick(["dev", "prod", "staging"]) : pick(["", 3]);
  return p;
}
function environment() {
  if (rand() < 0.04) return pick(["x", 3, [], null]);
  const e = {};
  if (rand() < 0.7) e.values = rand() < 0.95 ? Object.fromEntries(Array.from({ length: int(4) }, () => [pick(["B", "A", "2", "1", "KEY_X", "__proto__"]), pick(scalars)])) : pick(["x", [], 3]);
  if (rand() < 0.4) e.secret_refs = rand() < 0.95 ? Object.fromEntries(Array.from({ length: int(3) }, () => [pick(["TOKEN", "2", "API"]), rand() < 0.9 ? { ...(rand() < 0.8 ? { provider: pick(["keychain", "env", "file", "bogus", null, 3]) } : {}), ...(rand() < 0.8 ? { ref: pick(["svc/x", "", null, 4, ["a"]]) } : {}) } : pick(["x", 3])])) : pick(["x", [], 3]);
  if (rand() < 0.1) e.other = 1;
  return e;
}
function plugin() {
  if (rand() < 0.04) return pick(["x", 3, null]);
  const p = {};
  if (rand() < 0.3) p.version = "1.0.0";
  if (rand() < 0.95) p.name = rand() < 0.9 ? pick(["inline-a", "inline-b"]) : pick(["", 3]);
  if (rand() < 0.3) p.resources = [{ type: "skill", name: "s" }];
  if (rand() < 0.2) p["2"] = "two";
  return p;
}
function buildDocument() {
  const doc = { name: pick(["demo", "acme"]), version: "1.0.0" };
  if (rand() < 0.2) doc.description = pick(["desc", ""]);
  if (rand() < 0.4) doc.default_profile = rand() < 0.93 ? pick(["dev", "prod", "nope"]) : pick(["", 3, null]);
  if (rand() < 0.6) {
    if (rand() < 0.02) doc.environments = pick([[], "x", 3]);
    else {
      const envs = {};
      if (rand() < 0.5) envs.default = rand() < 0.93 ? pick(["dev", "prod", "missing"]) : pick(["", 3, null]);
      for (let i = int(4); i > 0; i--) envs[pick(["dev", "prod", "staging", "2", "1"])] = environment();
      doc.environments = envs;
    }
  }
  if (rand() < 0.6) doc.profiles = rand() < 0.02 ? pick(["x", {}, 3]) : Array.from({ length: int(4) }, profile);
  if (rand() < 0.5) doc.plugins = rand() < 0.05 ? pick(["x", {}, 3]) : Array.from({ length: int(3) }, plugin);
  if (rand() < 0.3) doc[pick(["x-harnesstap", "default_environment", "environment", "scripts", "2", "target"])] = pick(["v", 1, ["claude"]]);
  if (rand() < 0.2) doc.dependencies = { apm: ["acme/x"] };
  const keys = Object.keys(doc);
  if (rand() < 0.3) keys.sort(() => rand() - 0.5);
  return Object.fromEntries(keys.map((k) => [k, doc[k]]));
}

// About half the documents are redrawn until they parse, so the success paths get as many
// cases as the error paths.
function buildYaml(options) {
  const wantOk = rand() < 0.5;
  for (let attempt = 0; ; attempt++) {
    const raw = stringifyYaml(buildDocument(), options);
    if (!wantOk || attempt >= 20) return raw;
    try { pc.parseProjectConfigContents(raw, "apm.yml"); return raw; } catch {}
  }
}

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "pc-rec-")));
const emptyRoot = join(scratch, "empty");
mkdirSync(emptyRoot);

const contents = [];
for (let i = 0; i < 2500; i++) {
  const raw = buildYaml({ indent: 2, lineWidth: 0, defaultKeyType: "PLAIN" });
  const rec = { raw };
  try {
    const config = pc.parseProjectConfigContents(raw, "apm.yml");
    rec.config = encConfig(config);
    rec.validation = pc.validateProjectConfig(config);
    const key = pick(["dev", "prod", "ci", "nope"]);
    try { const entry = pc.getProfileEntry(config, key); rec.profile = { key, environment: pc.resolveProfileEnvironment(config, entry) ?? null }; } catch (e) { rec.profile = { key, err: err(e) }; }
  } catch (e) { rec.err = err(e); }
  currentRoot = emptyRoot;
  const ev = pc.evaluateProjectConfigContents(raw, "apm.yml", emptyRoot);
  rec.evaluate = ev.ok ? { ok: true } : { ok: false, errors: ev.errors.map(scrub) };
  currentRoot = "\0";
  contents.push(rec);
}

const localTomls = [
  null, "", "default_profile = \"dev\"\n", "default_environment = \"prod\"\ndefault_profile = \"ci\"\n", "default_profile = \"\"\n", "default_profile = 3\n",
  "default_environment = 2024-01-01\n", "default_profile = [\"a\"]\n", "[table]\nx = 1\n", "default_profile = \"dev\"\nother = { a = 1 }\n", "not toml\n", "a = \n",
  "default_profile = 'lit'\n", "default_profile = \"\"\"multi\nline\"\"\"\n", "a = 1\na = 2\n", "default_profile = \"dev\" # comment\n", "\uFEFFdefault_profile = \"bom\"\n",
  "default_profile = \"dev\"\r\n", "x = 1979-05-27T07:32:00Z\n", "x = inf\ny = nan\n", "x = 0xDEAD\n", "default_environment = true\n",
];
const trees = [];
for (let i = 0; i < 300; i++) {
  const root = join(scratch, `t${i}`);
  currentRoot = root;
  const depth = int(3);
  const nested = ["a", "b", "c"].slice(0, depth).join("/");
  const project = join(root, "proj");
  mkdirSync(join(project, nested), { recursive: true });
  const kind = i < 3 ? ["none", "dir", "symlink"][i] : rand() < 0.08 ? pick(["none", "dir"]) : "file";
  const raw = kind === "file" ? (rand() < 0.1 ? pick(["- a\n", "name: x\n", "name: [\n"]) : buildYaml({ indent: 2, lineWidth: 0 })) : null;
  if (raw !== null) writeFileSync(join(project, "apm.yml"), raw);
  if (kind === "dir") mkdirSync(join(project, "apm.yml"));
  if (kind === "symlink") { writeFileSync(join(project, "real.yml"), "name: s\nversion: 1.0.0\n"); symlinkSync("real.yml", join(project, "apm.yml")); }
  const local = rand() < 0.6 ? pick(localTomls) : null;
  if (local !== null) { mkdirSync(join(project, ".harnesstap"), { recursive: true }); writeFileSync(join(project, ".harnesstap", "local.toml"), local); }
  const skills = rand() < 0.15;
  if (skills) { mkdirSync(join(project, "skills", "s"), { recursive: true }); writeFileSync(join(project, "skills", "s", "SKILL.md"), "---\nname: s\ndescription: d\n---\nbody\n"); }
  const file = rand() < 0.3;
  if (file) writeFileSync(join(project, nested, "file.txt"), "x");
  const start = pick(["proj", `proj/${nested}`, `proj/${nested}/file.txt`, "proj/missing/deeper"]);
  const rec = { kind, raw, local, nested, start, skills, file };
  const startPath = join(root, start);
  const located = pc.locateProjectManifest(startPath);
  rec.located = located ? { rootPath: scrub(located.rootPath), configPath: scrub(located.configPath) } : null;
  try {
    const found = pc.findProjectConfig(startPath);
    rec.found = found ? {
      config: encConfig(found), rootPath: scrub(found.rootPath), configPath: scrub(found.configPath),
      harnessTargets: found.harnessTargets, skippedTargets: found.skippedTargets, warnings: found.warnings,
      apmDependencies: JSON.parse(JSON.stringify(found.apmDependencies)), mcpDependencies: JSON.parse(JSON.stringify(found.mcpDependencies)),
      hasPolicyPin: "policyPin" in found, overlaySkills: found.overlay ? found.overlay.skills.map((s) => s.name) : null, hasCompilation: "compilation" in found,
    } : null;
  } catch (e) { rec.foundErr = err(e); }
  try { rec.merged = encConfig(pc.mergeProjectConfigLocalOverrides({ profiles: [], environments: [], plugins: [], default_profile: "base" }, join(project, ".harnesstap"))); } catch (e) { rec.mergedErr = err(e); }
  trees.push(rec);
}
currentRoot = "\0";
rmSync(scratch, { recursive: true, force: true });

const stats = { contents: contents.length, ok: contents.filter((c) => c.config).length, valid: contents.filter((c) => c.validation?.valid).length, trees: trees.length, found: trees.filter((t) => t.found).length };
writeFileSync(new URL("./fixtures/project-config.json", import.meta.url), JSON.stringify({ generator: "make-project-config-fixtures.mjs", stats, contents, trees }) + "\n");
console.log(JSON.stringify(stats));
