// Records config/settings.ts for tests/fixtures.rs: parseJsonc, loadSettings,
// readToolkitConfigRecord, saveSettings and saveUpdateSettings on generated
// config files. Run from the repo root under Node (the CLI's runtime):
//   node --experimental-transform-types --import ./rust/apm-rs/tests/ts-resolve.mjs rust/settings-rs/tests/make-fixtures.mjs
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as s from "../../../src/config/settings.ts";
import * as mode from "../../../src/services/plugin-resource-mode.ts";

let seed = 0x5e771;
function rand() {
  seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0;
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 0x297a2d39);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const int = (n) => Math.floor(rand() * n);

const NUMS = [0, 1, 2, 10, -1, 1.5, 24, 0.5, "10", null, true, 1e3, 3.0];
const STRS = ["", " a ", "x", "  ", "main", "dev", "main"];
function value(depth) {
  const k = int(depth > 2 ? 4 : 7);
  if (k === 0) return pick(NUMS);
  if (k === 1) return pick(STRS);
  if (k === 2) return pick([true, false, null]);
  if (k === 3) return pick(["symlink", "copy", "clone", "off", "notify", "install", "hourly", "daily", "weekly", "claude-code", "cursor", "goose", "copilot-cli", "bogus"]);
  if (k === 4) return Array.from({ length: int(4) }, () => value(depth + 1));
  return object(depth + 1);
}
const KEYS = ["plugins", "refreshMaxAgeHours", "marketplaceRefreshMaxAgeMinutes", "marketplaces", "pluginVersionHistoryLimit", "harnessSync", "pluginResources", "nativeAgentPlugins", "updates", "mode", "frequency", "prompted", "name", "url", "platforms", "trackedBranches", "other"];
function object(depth) {
  const o = {};
  for (let i = int(5); i > 0; i -= 1) o[pick(KEYS)] = value(depth);
  return o;
}
function marketplace() {
  const m = {};
  if (rand() < 0.9) m.name = pick([" mk ", "m", "", 3, "  "]);
  if (rand() < 0.9) m.url = pick(["https://x/y", " u ", "", null]);
  if (rand() < 0.9) m.platforms = rand() < 0.8 ? Array.from({ length: int(4) }, () => pick(["cursor", "goose", "claude-code", "copilot-cli", "x", 1])) : "cursor";
  if (rand() < 0.5) m.trackedBranches = rand() < 0.8 ? Array.from({ length: int(5) }, () => pick([...STRS, 1, null])) : "main";
  return m;
}
function config() {
  if (rand() < 0.05) return pick([null, 1, "s", []]);
  const c = object(1);
  if (rand() < 0.6) c.plugins = rand() < 0.1 ? null : { refreshMaxAgeHours: pick(NUMS), marketplaceRefreshMaxAgeMinutes: pick(NUMS), marketplaces: rand() < 0.8 ? Array.from({ length: int(4) }, () => (rand() < 0.1 ? pick([null, 1, ["a"]]) : marketplace())) : pick([null, {}]) };
  if (rand() < 0.6) c.pluginVersionHistoryLimit = pick(NUMS);
  if (rand() < 0.5) c.harnessSync = rand() < 0.1 ? null : { pluginResources: pick(["symlink", "copy", "clone", "x", 1]), nativeAgentPlugins: pick([true, false, "true", 1]) };
  if (rand() < 0.5) c.updates = rand() < 0.1 ? pick([null, [], "x"]) : { mode: pick(["off", "notify", "install", "x"]), frequency: pick(["hourly", "daily", "weekly", 1]), prompted: pick([true, false, "yes"]) };
  return c;
}
/** JSON text with comments, trailing commas and odd spacing sprinkled in. */
function jsonc(v) {
  let text = JSON.stringify(v, null, pick([0, 2, "\t"]));
  if (rand() < 0.6) text = text.replace(/([}\]])/g, (m) => (rand() < 0.3 ? `, ${pick(["", "// c\n", "/* b */", "\n"])}${m}` : m));
  if (rand() < 0.4) text = text.replace(/,/g, (m) => (rand() < 0.3 ? `${m} /* x, y */` : rand() < 0.2 ? `${m} // tail, ,\n` : m));
  if (rand() < 0.3) text = `// header\n/* multi\n line */ ${text}`;
  if (rand() < 0.1) text += pick([" // end", " /* end", ",", " ,", "\n// x"]);
  if (rand() < 0.05) text = pick(["", "{", "{\"a\":1,,}", "{'a': 1}", "{\"a\": \"/* not a comment */\", \"b\": \"// no\", \"c\": \"\\\" // \"}", "\ufeff{}", "{\"a\":1}\u00a0", "[1,\n]"]);
  return text;
}

const cases = [];
for (let i = 0; i < 2500; i += 1) {
  const text = jsonc(config());
  const dir = mkdtempSync(join(tmpdir(), "ht-settings-"));
  const file = pick(["config.json", "config.jsonc", "both", "none", "dir"]);
  if (file === "both") {
    writeFileSync(join(dir, "config.jsonc"), text);
    writeFileSync(join(dir, "config.json"), "{\"pluginVersionHistoryLimit\": 3}");
  } else if (file === "dir") {
    mkdirSync(join(dir, "config.jsonc"));
  } else if (file !== "none") {
    writeFileSync(join(dir, file), text);
  }
  const out = { file, text };
  try { out.parsed = s.parseJsonc(text); } catch { out.parseError = true; }
  out.load = s.loadSettings(dir);
  out.record = s.readToolkitConfigRecord(dir);
  if (i % 3 === 0) {
    const patch = {};
    if (rand() < 0.5) patch.mode = pick(["off", "install", "x"]);
    if (rand() < 0.5) patch.prompted = pick([true, false]);
    if (rand() < 0.5) patch.frequency = pick(["weekly", 3]);
    out.patch = patch;
    try {
      out.saved = s.saveUpdateSettings(dir, patch);
      out.written = readFileSync(s.settingsPath(dir), "utf8");
    } catch (e) { out.saveError = true; }
  } else if (i % 3 === 1) {
    try {
      s.saveSettings(dir, out.load);
      out.written = readFileSync(s.settingsPath(dir), "utf8");
    } catch (e) { out.saveError = true; }
  }
  rmSync(dir, { recursive: true, force: true });
  cases.push(out);
}
const modes = ["symlink", "copy", "clone", "x", "", undefined].map((v) => {
  try { return { v, ok: mode.parsePluginResourceMode(v) }; } catch (e) { return { v: v ?? null, err: e.message }; }
});
writeFileSync("rust/settings-rs/tests/fixtures/settings.json", JSON.stringify({ cases, modes }) + "\n");
console.log(`${cases.length} cases, ${cases.filter((c) => c.parseError).length} unparsable, ${cases.filter((c) => c.written).length} writes`);
