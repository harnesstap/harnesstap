// Records the original CLI (dist/bin.js, built with HT_RELEASE=1) on argv generated
// from data/tree.json: help flags, unknown options and their near misses, excess
// arguments, unknown subcommands, bad choices, missing option values, and the
// runtime guards. Each run goes through rust/run-sandboxed.sh (fresh HOME, no color,
// telemetry off), each in an empty working folder of its own, since some argv run
// real actions. Writes tests/fixtures/runs.json.
// Run from the repo root: node rust/cli-rs/tests/make-fixtures.mjs
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

const results = new Array(cases.length);
let next = 0;
async function worker() {
  while (next < cases.length) {
    const i = next++;
    const args = cases[i];
    let stdout = "", stderr = "", code = 0;
    const cwd = mkdtempSync(join(tmpdir(), "cli-rs-case-"));
    try {
      ({ stdout, stderr } = await run("bash", [sandbox, "node", bin, ...args], { timeout: 60000, cwd }));
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
