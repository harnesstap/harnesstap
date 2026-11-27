// Records the original CLI (dist/bin.js, built with HT_RELEASE=1) on argv generated
// from data/tree.json: help flags, unknown options and their near misses, excess
// arguments, unknown subcommands, bad choices, missing option values, and the
// runtime guards. Each run goes through rust/run-sandboxed.sh (fresh HOME, no color,
// telemetry off, update check skipped), each in an empty working folder of its own, since some argv run
// real actions. Writes tests/fixtures/runs.json.
// Then the harness actions across states (tests/fixtures/harness-runs.json): see below.
// Run from the repo root: node rust/cli-rs/tests/make-fixtures.mjs
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = new URL(".", import.meta.url).pathname;
const repo = resolve(here, "..", "..", "..");
const sandbox = join(repo, "rust", "run-sandboxed.sh");
const bin = join(repo, "dist", "bin.js");
const tree = JSON.parse(readFileSync(join(here, "..", "data", "tree.json"), "utf8"));

const cases = [];
const add = (args) => cases.push(args);

for (const a of [[], ["--help"], ["-h"], ["-v", "--help"], ["--no-color"], ["--", "x"], ["uninstall"], ["version"],
  ["frobnicate"], ["frobnicate", "--x"], ["default"], ["work", "--json"], ["--bogus"], [""], ["-"], ["--no-interactive", "zz"]]) add(a);

function typo(word) {
  // swap two letters, drop one: commander's suggestions
  if (word.length < 4) return `${word}x`;
  return `${word.slice(0, 1)}${word[2]}${word[1]}${word.slice(3)}`;
}

function walk(node, path) {
  add([...path, "--help"]);
  add([...path, "-h", "extra"]);
  add([...path, "--definitely-unknown"]);
  add([...path, "a1", "a2", "a3", "a4"]);
  add([...path, "日本語"]);
  if (node.commands.length) {
    add([...path, typo(node.commands[0].name)]);
    add([...path, "help"]);
    add([...path, "help", node.commands[0].name]);
    add([...path, "help", "nope"]);
  }
  for (const o of node.options.slice(0, 6)) {
    if (o.long) add([...path, `${typo(o.long.slice(2)).replace(/^/, "--")}`]);
    if (o.required) add([...path, o.long ?? o.short]);
    if (o.choices) add([...path, o.long ?? o.short, "not-a-choice"]);
    if (o.long && (o.required || o.optional)) add([...path, `${o.long}=v`, "--zz"]);
  }
  for (const c of node.commands) walk(c, [...path, c.name]);
}
for (const nodes of Object.values(tree.loaders)) for (const n of nodes) walk(n, [n.name]);
for (const e of tree.catalog) for (const alias of e.aliases) add([alias, "--nope"]);

// help and help scenario (actions answered in Rust)
const scenarioIds = JSON.parse(readFileSync(join(here, "..", "data", "scenarios.json"), "utf8")).map((s) => String(s.id));
for (const fmt of [[], ["--format", "json"], ["--format", "human"], ["--format", ""], ["--format", "xml"], ["--format=json"]]) {
  add(["help", ...fmt]);
  for (const id of [...scenarioIds, "0", "99", "x", "11abc", " 7", "+3", "-1", "1e21", "99999999999999999999999", ""]) {
    add(["help", "scenario", id, ...fmt]);
  }
}

const results = new Array(cases.length);
let next = 0;
async function worker() {
  while (next < cases.length) {
    const i = next++;
    const args = cases[i];
    let stdout = "", stderr = "", code = 0;
    const cwd = mkdtempSync(join(tmpdir(), "cli-rs-case-"));
    try {
      ({ stdout, stderr } = await run("bash", [sandbox, "node", bin, ...args], {
        timeout: 60000,
        cwd,
        // Successful runs would otherwise go on to the update check.
        env: { ...process.env, HARNESSTAP_SKIP_UPDATE_CHECK: "1" },
      }));
    } catch (error) {
      ({ stdout = "", stderr = "" } = error);
      code = error.code ?? 1;
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
    results[i] = { args, stdout, stderr, code };
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
mkdirSync(join(here, "fixtures"), { recursive: true });
writeFileSync(join(here, "fixtures", "runs.json"), `${JSON.stringify(results, null, 1)}\n`);
console.log(`${results.length} runs`);

// Harness actions across states. Each case gets its own HOME under a fixed lowercase folder
// (so the macOS project ids, which are lowercased real paths, read the same everywhere),
// writes the state's files, runs the state's setup argv there, then the argv from HOME/proj.
// It records the database rows and the files under HOME before the argv (paths as $HOME,
// to rebuild the state) and after it, with stdout and stderr (also with ULIDs as <id> and
// times as <ts>).
const HARNESS_BASE = "/tmp/ht-cli-harness";
const states = {
  fresh: {},
  init: { setup: [["init"]] },
  set: { setup: [["harness", "set", "--harnesses", "codex,claude-code"]] },
  project: { setup: [["harness", "project", "set", "--harnesses", "cursor,codex", "--materialization-strategy", "copy"]] },
  dirs: { files: { "proj/.claude/skills/": true, "proj/.cursor/rules/": true, "proj/AGENTS.md": "x\n" } },
  config: {
    files: { ".harnesstap/config.jsonc": "{\n  // sync\n  \"harnessSync\": { \"pluginResources\": \"copy\" },\n}\n" },
    setup: [["harness", "set", "--harnesses", "warp"]],
  },
};
const harnessArgv = [
  ["harness", "list"], ["harness", "ls", "--supported"], ["h", "list", "--format", "json"],
  ["harness", "list", "--supported", "--format=json"], ["harness", "list", "--format", "xml"],
  ["harness", "status"], ["harness", "status", "--format", "json"], ["harness", "status", "--format", "yaml"],
  ["harness", "set", "--harnesses", "codex,claude-code,codex"], ["harness", "set"], ["harness", "set", "--harnesses", "nope,x"],
  ["harness", "set", "--main", "cursor", "--aliases", "codex,cursor"], ["harness", "set", "--harnesses", " , "],
  ["harness", "set", "--interactive", "--main", ""],
  ["harness", "project", "status"], ["harness", "project", "status", "--format", "json"],
  ["harness", "project", "status", "--project", "sub"], ["harness", "project", "status", "--format", "bad"],
  ["harness", "project", "set", "--harnesses", "cursor"], ["harness", "project", "set"],
  ["harness", "project", "set", "--harnesses", "codex", "--materialization-strategy", "copy"],
  ["harness", "project", "set", "--materialization-strategy", "weird"],
  ["harness", "project", "set", "--project", "sub/deeper", "--harnesses", "gemini-cli"],
  ["harness", "project", "set", "--harnesses", "nope"], ["harness", "project", "set", "--project", ".."],
  ["harness", "sync", "--dry-run"],
];
function normHome(text, home) {
  for (const from of [realpathSync(home), home]) text = text.split(from).join("$HOME");
  return text;
}
const normAll = (text, home) => normHome(text, home)
  .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, "<ts>")
  .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, "<id>");
function snapshot(home, norm) {
  const files = {};
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const r = `${rel}${name}`;
      if (statSync(full).isDirectory()) {
        files[`${r}/`] = true;
        walk(full, `${r}/`);
      } else {
        files[r] = /\.db(-wal|-shm|-journal)?$/.test(name) ? "<db>" : readFileSync(full, "utf8");
      }
    }
  };
  walk(home, "");
  const tables = {};
  const dbPath = join(home, ".harnesstap", "harnesstap.db");
  if (existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath);
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    for (const { name } of names) {
      const rows = db.prepare(`SELECT * FROM "${name}"`).all().map((row) =>
        Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? { $blob: Buffer.from(v).toString("hex") } : v])));
      if (rows.length) tables[name] = rows;
    }
    db.close();
  }
  return JSON.parse(norm(JSON.stringify({ files, tables }), home));
}
const harnessCases = [];
for (const [state, def] of Object.entries(states)) for (const args of harnessArgv) harnessCases.push({ state, args });
const harnessResults = new Array(harnessCases.length);
rmSync(HARNESS_BASE, { recursive: true, force: true });
let nextHarness = 0;
async function sandboxed(home, args) {
  try {
    const { stdout, stderr } = await run("bash", [sandbox, "node", bin, ...args], {
      timeout: 60000,
      cwd: join(home, "proj"),
      env: { ...process.env, HARNESSTAP_SKIP_UPDATE_CHECK: "1", HT_SANDBOX_HOME: home },
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", code: error.code ?? 1 };
  }
}
async function harnessWorker() {
  while (nextHarness < harnessCases.length) {
    const i = nextHarness++;
    const { state, args } = harnessCases[i];
    const def = states[state];
    const home = join(HARNESS_BASE, String(i));
    mkdirSync(join(home, "proj"), { recursive: true });
    for (const [path, content] of Object.entries(def.files ?? {})) {
      const full = join(home, path);
      if (content === true) mkdirSync(full, { recursive: true });
      else {
        mkdirSync(resolve(full, ".."), { recursive: true });
        writeFileSync(full, content);
      }
    }
    for (const setup of def.setup ?? []) {
      const out = await sandboxed(home, setup);
      if (out.code !== 0) throw new Error(`setup ${setup.join(" ")} failed: ${out.stderr}`);
    }
    const before = snapshot(home, normHome);
    const out = await sandboxed(home, args);
    const after = snapshot(home, normAll);
    harnessResults[i] = { state, args, before, stdout: normAll(out.stdout, home), stderr: normAll(out.stderr, home), code: out.code, after };
    rmSync(home, { recursive: true, force: true });
  }
}
await Promise.all(Array.from({ length: 8 }, harnessWorker));
rmSync(HARNESS_BASE, { recursive: true, force: true });
writeFileSync(join(here, "fixtures", "harness-runs.json"), `${JSON.stringify(harnessResults, null, 1)}\n`);
console.log(`${harnessResults.length} harness runs`);
