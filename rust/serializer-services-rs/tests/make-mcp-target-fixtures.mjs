// Records src/services/mcp-target.ts for tests/mcp_target_fixtures.rs: sourceMatchesManagedPath,
// harnessIdsForMcpPath, isPortableMcpResource and filterMcpServersForTargetPath on generated
// resources and every MCP and settings path of the registry. Run from the repo root under Node:
//   node --experimental-transform-types --import ./rust/apm-rs/tests/ts-resolve.mjs rust/serializer-services-rs/tests/make-mcp-target-fixtures.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { getAllPlatforms } from "../../../src/platforms/registry.ts";
import * as m from "../../../src/services/mcp-target.ts";

let seed = 0x3c9a7;
function rand() {
  seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0;
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 0x297a2d39);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const int = (n) => Math.floor(rand() * n);
const chance = (p) => rand() < p;
const run = (fn) => {
  try {
    return { ok: fn() };
  } catch (e) {
    return { err: `${e.name}: ${e.message}` };
  }
};

const registryPaths = [];
for (const p of getAllPlatforms()) {
  for (const c of [p.projectPaths.mcp, p.globalPaths.mcp, p.globalPaths.settings, p.projectPaths.settings]) if (c) registryPaths.push(c);
}
const ids = getAllPlatforms().map((p) => p.id);
const ROOTS = ["", "/proj", "/proj/", "C:\\proj", "C:\\proj\\", "/", "~"];
function variant(path, root) {
  let p = path;
  const r = rand();
  if (r < 0.15 && !p.startsWith("~/")) p = `~/${p}`;
  else if (r < 0.3 && p.startsWith("~/")) p = p.slice(2);
  else if (r < 0.4) p = `./${p.replace(/^~\//, "")}`;
  else if (r < 0.5 && root) p = `${root.replace(/[\\/]$/, "")}/${p.replace(/^~\//, "")}`;
  else if (r < 0.55) p = p.replace(/\//g, "\\");
  else if (r < 0.6) p = p.toUpperCase();
  return p;
}
const OTHER = ["", " ", "manual", " manual ", "apm.yml", "pkg/apm.yml", "pkg\\apm.yml", "plugin.json", "mcp.json", ".mcp.json", "mcp-config.json", "x/MCP_config.json", "opencode.json", "~/.claude.json#local:/p", "~/.claude.json#local:", "~/.claude.json", "random/file.json", "~/", "./", "proj/.cursor/mcp.json", "~/~/.cursor/mcp.json"];
function source(root) {
  if (chance(0.1)) return undefined;
  return chance(0.6) ? variant(pick(registryPaths), root) : pick(OTHER);
}
function metadata() {
  if (chance(0.03)) return pick([undefined, null]);
  const meta = {};
  if (chance(0.9)) meta.transport = pick(["stdio", "http", "sse", "ws", ""]);
  if (chance(0.25)) meta.connection_type = pick(["sse", "streamable", "", null, 0]);
  if (chance(0.15)) meta.framing = pick(["ndjson", "", true, false, 0]);
  if (chance(0.15)) meta.claude_mcp_scope = pick(["local", "user", "project"]);
  if (chance(0.4)) meta.env = pick([{}, { PATH: "x" }, { CLAUDE_X: "1" }, { my_Cursor_key: "" }, { OpenCode: 1 }, "claude", ["codex"], null, { a: 1, CODEXY: 2 }]);
  if (chance(0.2)) meta.imported_from = pick([{ plugin_name: "p", relative_path: ".mcp.json" }, { plugin_name: "", relative_path: "x" }, { plugin_name: "p" }, { plugin_name: 3, relative_path: "x" }, "p", ["p"], null]);
  return meta;
}
function scope() {
  const r = rand();
  if (r < 0.55) return undefined;
  if (r < 0.62) return null;
  if (r < 0.72) return { kind: "all" };
  return { kind: "subset", harnesses: Array.from({ length: int(3) }, () => pick(ids)) };
}
function resource(root) {
  const r = { type: chance(0.85) ? "mcp_server" : pick(["skill", "hook", "rule"]), name: `r${int(1000)}`, metadata: metadata() };
  const s = source(root);
  if (s !== undefined) r.source = s;
  const sc = scope();
  if (sc !== undefined) r.harness_scope = sc;
  return r;
}

const cases = [];
for (let i = 0; i < 600; i++) {
  const root = pick(ROOTS);
  const resources = Array.from({ length: 1 + int(6) }, () => resource(root));
  const target = chance(0.1) ? pick([undefined, ""]) : chance(0.8) ? variant(pick(registryPaths), root) : pick(OTHER);
  const platformId = chance(0.7) ? undefined : pick([...ids, "", "nope"]);
  const kept = run(() => m.filterMcpServersForTargetPath(resources, target, root, platformId).map((r) => resources.indexOf(r)));
  cases.push({ fn: "filter", resources, target, root, platformId, out: kept });
  for (const r of resources) cases.push({ fn: "portable", resource: r, out: run(() => m.isPortableMcpResource(r)) });
}
for (let i = 0; i < 800; i++) {
  const root = pick(ROOTS);
  const base = pick(registryPaths);
  const a = chance(0.8) ? variant(base, root) : pick(OTHER);
  const b = chance(0.6) ? variant(base, root) : chance(0.7) ? variant(pick(registryPaths), root) : pick(OTHER);
  cases.push({ fn: "matches", source: a, managed: b, root, out: m.sourceMatchesManagedPath(a || undefined, b, root) });
  cases.push({ fn: "ids", target: b, root, out: m.harnessIdsForMcpPath(b, root) });
}
for (const r of [{ type: "mcp_server" }, { type: "mcp_server", metadata: null }]) cases.push({ fn: "portable", resource: r, out: run(() => m.isPortableMcpResource(r)) });

mkdirSync(new URL("./fixtures/", import.meta.url), { recursive: true });
writeFileSync(new URL("./fixtures/mcp-target.json", import.meta.url), `${JSON.stringify(cases)}\n`);
console.log(`mcp-target ${cases.length}`);
