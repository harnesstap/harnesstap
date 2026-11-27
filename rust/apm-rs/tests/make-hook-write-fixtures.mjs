// Records the writing half of src/services/hook-serialization.ts for tests/hook_write_fixtures.rs:
// buildHooksJson (both shapes, with and without plugin-root hooks), userHooksForHostConfig,
// hookRequiresPluginRoot and stripPluginRootCommandsFromHooksObject on generated hook metadata.
// Run from the repo root under Node:
//   node --experimental-transform-types --import ./rust/apm-rs/tests/ts-resolve.mjs rust/apm-rs/tests/make-hook-write-fixtures.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import {
  buildHooksJson,
  hookRequiresPluginRoot,
  parseHooksJsonContent,
  stripPluginRootCommandsFromHooksObject,
  userHooksForHostConfig,
} from "../../../src/services/hook-serialization.ts";

let seed = 0x4007c;
function rand() {
  seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0;
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 0x297a2d39);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const int = (n) => Math.floor(rand() * n);
const chance = (p) => rand() < p;

const EVENTS = ["PreToolUse", "PostToolUse", "Stop", "SessionStart", "beforeShellExecution", "2", "1", "__proto__"];
const COMMANDS = ["echo hi", "./hooks/run.sh", "hooks/x.sh", "bash ${CLAUDE_PLUGIN_ROOT}/x", "node \"hooks/a.js\"", "x=hooks/y", "(hooks/z)", "`hooks/q`", "myhooks/run", "", "npx lint"];
const MATCHERS = ["Bash", "Edit|Write", "", "Bash", "*"];
function entry() {
  const e = {};
  if (chance(0.7)) e.type = "command";
  if (chance(0.85)) e.command = pick([...COMMANDS, null, 0, false]);
  if (chance(0.2)) e.timeout = pick([5, "7", 1.5]);
  if (chance(0.15)) e.statusMessage = "Running";
  if (chance(0.1)) e.commandWindows = "run.ps1";
  return e;
}
function hookEntry() {
  const r = rand();
  if (r < 0.15) return { matcher: pick(MATCHERS), hooks: Array.from({ length: int(3) }, () => (chance(0.9) ? entry() : pick([null, 3, [], "s"]))) };
  if (r < 0.2) return { matcher: pick(MATCHERS), command: pick(COMMANDS) };
  if (r < 0.23) return pick([null, "str", [], 0]);
  return entry();
}
function hook() {
  const h = { event: chance(0.95) ? pick(EVENTS) : pick([undefined, 3]) };
  if (chance(0.9)) h.script = pick([...COMMANDS, null]);
  if (chance(0.6)) h.hook_entry = hookEntry();
  if (chance(0.2)) h.commandWindows = pick(["w.ps1", 3]);
  if (chance(0.2)) h.timeout = pick([10, "10", 0]);
  if (chance(0.4)) h.matcher = pick(MATCHERS);
  if (chance(0.1)) h.requires_plugin_root = pick([true, false, "true"]);
  if (chance(0.3)) h.name = `h${int(100)}`;
  return h;
}

const cases = [];
for (let i = 0; i < 1200; i++) {
  const hooks = Array.from({ length: 1 + int(6) }, hook);
  const options = {};
  if (chance(0.5)) options.shape = pick(["wrapped", "flat"]);
  if (chance(0.3)) options.includePluginRoot = pick([true, false]);
  if (chance(0.3)) options.version = pick([1, 2]);
  const split = userHooksForHostConfig(hooks);
  cases.push({
    hooks,
    options,
    built: buildHooksJson(hooks, options),
    requires: hooks.map(hookRequiresPluginRoot),
    kept: split.hooks.map((h) => hooks.indexOf(h)),
  });
}
// The hooks of real files, read back, built again, then stripped.
const strips = [];
for (let i = 0; i < 400; i++) {
  const doc = buildHooksJson(Array.from({ length: 1 + int(6) }, hook), { includePluginRoot: true, shape: pick(["wrapped", "flat"]) });
  if (chance(0.2)) doc.hooks[pick(EVENTS)] = pick(["str", { command: "./hooks/x" }, null, [{ hooks: [{ command: "" }, { command: "./hooks/a" }] }], [3, [], { hooks: "x" }]]);
  const text = JSON.stringify(doc);
  const read = parseHooksJsonContent(text, "hooks.json").map((r) => ({ ...r.metadata, name: r.name }));
  strips.push({ hooks: doc.hooks, stripped: stripPluginRootCommandsFromHooksObject(doc.hooks), read, rebuilt: buildHooksJson(read) });
}
mkdirSync(new URL("./fixtures/", import.meta.url), { recursive: true });
writeFileSync(new URL("./fixtures/hook-write.json", import.meta.url), `${JSON.stringify({ cases, strips })}\n`);
console.log(`hook-write ${cases.length} builds, ${strips.length} strips`);
