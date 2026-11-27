// Records the original CLI (dist/bin.js, built with HT_RELEASE=1) on argv generated
// from data/tree.json: help flags, unknown options and their near misses, excess
// arguments, unknown subcommands, bad choices, missing option values, and the
// runtime guards. Each run goes through rust/run-sandboxed.sh (fresh HOME, no color,
// telemetry off, update check skipped), each in an empty working folder of its own, since some argv run
// real actions. Writes tests/fixtures/runs.json.
// Then the project runs (`config`, `lock`): each gets a project folder and a HOME of its own,
// files in both, optionally a database (the original's schema, made by an argv it rejects,
// then SQL), and runs one argv with the sandbox's environment; what changed on disk is
// recorded with the output (paths as [ROOT] and [HOME], the database as rows). Writes
// tests/fixtures/projects.json.
// Run from the repo root: node rust/cli-rs/tests/make-fixtures.mjs
import { execFile } from "node:child_process";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

const only = process.argv.includes("--projects-only");
const results = new Array(only ? 0 : cases.length);
let next = 0;
async function worker() {
  while (next < results.length) {
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
if (!only) {
  writeFileSync(join(here, "fixtures", "runs.json"), `${JSON.stringify(results, null, 1)}\n`);
  console.log(`${results.length} runs`);
}

// Project runs.
const projects = [];
/** `setup`: `files` (in the project; a value of null makes a folder), `home` (in HOME),
 * `db` (true for the schema, or SQL to run on it), `cwd` (inside the project), `env`. */
const proj = (args, setup = {}) => projects.push({ args, ...setup });
const profileSql = (...names) => names.map((name, i) =>
  `INSERT INTO plugins (id, name, tags, created_at, updated_at) VALUES ('01J0000000000000000000000${i}', '${name}', '["profile"]', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');`).join("\n");

const minimal = "name: demo\nversion: 1.0.0\n";
const full = `name: demo
version: 1.2.3
description: A demo
targets: [claude, nope]
workspaces: [a]
dependencies:
  apm:
    - acme/repo#v1
    - {git: https://github.com/o/r.git, path: sub/x, ref: main}
  mcp:
    - io.github/x
default_profile: work
profiles:
  - name: work
    source: local
  - name: cat
    source: catalog
    selector: "@acme/very-long-selector-name-that-is-really-long-and-even-longer-than-that@^1.0.0"
    environment: prod
  - name: inl
    source: inline
    plugin: mine
environments:
  default: prod
  prod:
    values: {B: 1, "2": two, A: true}
    secret_refs:
      K: {provider: file, ref: x}
      E: {}
  dev: {}
plugins:
  - name: mine
    x: 1
`;
const manifests = {
  minimal,
  full,
  wide: `${minimal}profiles:\n${["a".repeat(40), "b".repeat(70), "c"].map((n, i) => `  - name: ${n}\n    source: catalog\n    selector: ${"s".repeat(30 + i * 40)}\n    environment: ${"e".repeat(10 + i * 15)}\n`).join("")}`,
  one: `${minimal}profiles:\n  - name: solo\n    source: local\n    selector: other\n`,
  unicode: `${minimal}profiles:\n  - name: café\n    source: local\n`,
  invalidYaml: "name: [demo\n",
  notMapping: "- a\n- b\n",
  empty: "",
  noName: "version: 1.0.0\n",
  noVersion: "name: demo\n",
  numberVersion: "name: demo\nversion: 2\n",
  profileNotTable: `${minimal}profiles: [x]\n`,
  profileNoSource: `${minimal}profiles:\n  - name: a\n`,
  profileBadSource: `${minimal}profiles:\n  - name: a\n    source: weird\n`,
  profileDup: `${minimal}profiles:\n  - {name: a, source: local}\n  - {name: a, source: local}\n`,
  inlineNoPlugin: `${minimal}profiles:\n  - {name: a, source: inline}\n`,
  catalogNoSelector: `${minimal}profiles:\n  - {name: a, source: catalog}\n`,
  profilesNotArray: `${minimal}profiles: {a: 1}\n`,
  envNotMapping: `${minimal}environments: [a]\n`,
  envDefaultBad: `${minimal}environments: {default: 3}\n`,
  envValuesBad: `${minimal}environments: {prod: {values: [1]}}\n`,
  envProviderBad: `${minimal}environments: {prod: {secret_refs: {K: {provider: vault}}}}\n`,
  pluginsNotArray: `${minimal}plugins: {a: 1}\n`,
  pluginNoName: `${minimal}plugins:\n  - x: 1\n`,
  defaultProfileBad: `${minimal}default_profile: 3\n`,
  invalidRefs: `${minimal}default_profile: ghost\nenvironments: {default: nowhere, prod: {}}\nprofiles:\n  - {name: a, source: inline, plugin: missing, environment: staging}\n  - {name: b, source: local, environment: prod}\n`,
  distributed: `${minimal}compilation: {strategy: distributed, target: [codex]}\n`,
};
for (const [name, text] of Object.entries(manifests)) {
  for (const command of ["show", "validate"]) {
    proj(["config", command], { files: { "apm.yml": text }, label: name });
    proj(["config", command, "--format", "json"], { files: { "apm.yml": text }, label: name });
  }
}
for (const command of ["show", "validate"]) {
  for (const fmt of [[], ["--format", "json"]]) {
    proj(["config", command, ...fmt]);
    proj(["config", command, ...fmt], { files: { "apm.yml": full, "sub/dir/": null }, cwd: "sub/dir" });
    proj(["config", command, "--project", "sub", ...fmt], { files: { "apm.yml": minimal, "sub/apm.yml": manifests.one } });
    proj(["config", command, "--project", "apm.yml", ...fmt], { files: { "apm.yml": full } });
    proj(["config", command, "--project", "missing/x", ...fmt], { files: { "apm.yml": minimal } });
    proj(["config", command, "--project", "..", ...fmt], { files: { "apm.yml": minimal, "a/": null }, cwd: "a" });
    proj(["config", command, ...fmt], { files: { "apm.yml/": null } });
    proj(["config", command, ...fmt], { files: { "apm.yml": manifests.one, ".harnesstap/local.toml": 'default_profile = "solo"\ndefault_environment = "x"\n' } });
    proj(["config", command, ...fmt], { files: { "apm.yml": minimal, ".harnesstap/local.toml": "default_profile = 3\n" } });
    proj(["config", command, ...fmt], { files: { "apm.yml": minimal, ".harnesstap/local.toml": "nope = [\n" } });
  }
  proj(["config", command, "--format", "xml"], { files: { "apm.yml": minimal } });
}

const db = true;
for (const fmt of [[], ["--format", "json"]]) {
  proj(["config", "init", ...fmt]);
  proj(["config", "init", ...fmt], { db });
  proj(["config", "init", ...fmt], { db, files: { "apm.yml": minimal } });
  proj(["config", "init", "--force", ...fmt], { db, files: { "apm.yml": full } });
  proj(["config", "init", "--profile", "work", ...fmt], { db });
  proj(["config", "init", "--profile", "global default", "--profile", "global default", "--default", "global default", ...fmt], { db });
  proj(["config", "init", "--default", "nope", ...fmt], { db });
  proj(["config", "init", "--project", "missing/deeper", ...fmt], { db });
  proj(["config", "init", "--project", "file/x", ...fmt], { db, files: { file: "x" } });
  proj(["config", "init", "--project", "file", ...fmt], { db, files: { file: "x" } });
  proj(["config", "init", "--force", ...fmt], { db, files: { "apm.yml/": null } });
  proj(["config", "init", "--project", "sub", ...fmt], { db, files: { "sub/": null } });
  proj(["config", "init", ...fmt], { db: profileSql("work", "personal", "zeta"), home: { ".harnesstap/active-profile.json": '{"name": "personal"}' } });
  proj(["config", "init", "--profile", "zeta", "--profile", "work", ...fmt], { db: profileSql("work", "personal", "zeta") });
  proj(["config", "init", "--default", "work", ...fmt], { db: profileSql("work", "personal") });
  proj(["config", "init", ...fmt], { db: profileSql("work"), home: { ".harnesstap/active-profile.json": "not json" } });
  proj(["config", "init", ...fmt], { db, home: { ".harnesstap/active-profile.json": '{"name": " empty "}', ".harnesstap/active-environment.json": '{"name": "kept"}' } });
  proj(["config", "init", ...fmt], { db: `${profileSql("work")}\nINSERT INTO environments (id, name, created_at, updated_at) VALUES ('01J1', 'staging', 'x', 'x');` });
  proj(["config", "init", ...fmt], { db: profileSql("default") });
  proj(["config", "init", ...fmt], { db: "INSERT INTO plugins (id, name, created_at, updated_at) VALUES ('01J2', 'global default', 'x', 'x');" });
}
proj(["config", "init", "--no-interactive"], { db });
proj(["config", "init", "--interactive", "--format", "json"], { db });
proj(["config", "init", "--format", "xml"], { db });

const hash = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const lockfile = `lockfile_version: "1"
generated_at: 2024-05-01T10:00:00Z
plugins:
  - name: local-one
    version: 1.0.0
    source: local
    integrity: ${hash}
    declared_license: MIT
  - name: repo
    version: ""
    source: git
    repo_url: https://user:tok@github.com/Acme/Repo.git?x=1
    resolved_commit: abc123
    declared_license: (MIT OR Apache-2.0)
  - name: cat
    version: 2.0.0
    source: catalog
    declared_license: Proprietary
`;
const locks = { lockfile, v9: 'lockfile_version: "9"\n', notMapping: "- 1\n", invalidYaml: "plugins: [\n", empty: 'lockfile_version: "1"\n' };
for (const [name, text] of Object.entries(locks)) {
  for (const fmt of [[], ["--format", "spdx"], ["-f", "SPDX", "--timestamp", "2024-06-01T05:30:00+05:30"]]) {
    proj(["lock", "export", ...fmt], { files: { "apm.lock.yaml": text }, label: name });
  }
}
proj(["lock", "export"]);
proj(["lock", "export", "--project", "sub"], { files: { "sub/apm.lock.yaml": lockfile } });
proj(["lock", "export", "--project", "."], { files: { "apm.lock.yaml": lockfile } });
proj(["lock", "export", "-o", "out/deep/sbom.json"], { files: { "apm.lock.yaml": lockfile } });
proj(["lock", "export", "-o", ""], { files: { "apm.lock.yaml": lockfile } });
proj(["lock", "export", "--project", "..", "--output=../sbom.json"], { files: { "apm.lock.yaml": lockfile, "a/": null }, cwd: "a" });
proj(["lock", "export", "-o", "file/x.json"], { files: { "apm.lock.yaml": lockfile, file: "x" } });
proj(["lock", "export", "--format", "xml"], { files: { "apm.lock.yaml": lockfile } });
proj(["lock", "export", "--global"]);
proj(["lock", "export", "-g"], { home: { ".harnesstap/apm.lock.yaml": lockfile } });
proj(["lock", "export", "-g", "--project", "x"]);
proj(["lock", "export", "-g", "--project", "."], { home: { ".harnesstap/apm.lock.yaml": lockfile } });
for (const ts of ["2024-06-01", "", "2024-13-01T00:00:00Z", "2023-02-30T24:00:00-01:00", "June 1 2024 +00:00", "garbage"]) {
  proj(["lock", "export", "--timestamp", ts], { files: { "apm.lock.yaml": lockfile } });
}
for (const epoch of ["1700000000", "9e15", "abc", "1.5"]) {
  proj(["lock", "export"], { files: { "apm.lock.yaml": lockfile }, env: { SOURCE_DATE_EPOCH: epoch } });
}

const sandboxEnv = (home, extra = {}) => {
  const env = { ...process.env };
  for (const k of ["HARNESSTAP_HOME", "HARNESSTAP_DEBUG", "GITHUB_TOKEN", "GH_TOKEN", "HARNESSTAP_TOKEN", "HARNESSTAP_CLOUD_TOKEN", "SOURCE_DATE_EPOCH"]) delete env[k];
  return Object.assign(env, {
    HOME: home, XDG_CONFIG_HOME: `${home}/.config`, XDG_DATA_HOME: `${home}/.local/share`,
    XDG_CACHE_HOME: `${home}/.cache`, XDG_STATE_HOME: `${home}/.local/state`,
    HARNESSTAP_TELEMETRY: "0", NO_COLOR: "1", FORCE_COLOR: "0", TERM: "dumb", CI: "1", TZ: "UTC",
    LANG: "C.UTF-8", LC_ALL: "C.UTF-8", BROWSER: "true", EDITOR: "true", VISUAL: "true", GIT_TERMINAL_PROMPT: "0",
    HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", http_proxy: "http://127.0.0.1:9",
    https_proxy: "http://127.0.0.1:9", NO_PROXY: "", NODE_USE_ENV_PROXY: "1",
    HARNESSTAP_CLOUD_URL: "http://127.0.0.1:9", HARNESSTAP_MCP_REGISTRY_URL: "http://127.0.0.1:9",
    HARNESSTAP_NO_INTERACTIVE: "1", HARNESSTAP_SKIP_UPDATE_CHECK: "1",
  }, extra);
};

function writeTree(base, files = {}) {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(base, rel);
    if (content === null) {
      mkdirSync(path, { recursive: true });
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

const DB_FILE = /harnesstap\.db(-wal|-shm|-journal)?$/;
function snapshot(dir, tag, out = {}) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = `${tag}/${name}`;
    const st = lstatSync(path);
    if (st.isDirectory()) {
      out[`${rel}/`] = null;
      snapshot(path, rel, out);
    } else if (!DB_FILE.test(name)) {
      out[rel] = readFileSync(path, "utf8");
    }
  }
  return out;
}

/** The rows `config init` writes, without ids and times. */
function dumpDb(home) {
  const path = join(home, ".harnesstap", "harnesstap.db");
  if (!existsSync(path)) return null;
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = (sql) => {
    try {
      return db.prepare(sql).all().map((r) => Object.values(r).map(String));
    } catch {
      return null;
    }
  };
  const out = {
    plugins: rows("SELECT name, version, description, tags, origin FROM plugins ORDER BY name, version"),
    environments: rows("SELECT name, description FROM environments ORDER BY name"),
  };
  db.close();
  return out;
}

const projectResults = new Array(projects.length);
let nextProject = 0;
async function projectWorker() {
  while (nextProject < projects.length) {
    const i = nextProject++;
    const c = projects[i];
    const base = realpathSync(mkdtempSync(join(tmpdir(), "cli-rs-proj-")));
    const root = join(base, "project");
    const home = join(base, "home");
    mkdirSync(root);
    mkdirSync(home);
    try {
      writeTree(root, c.files);
      writeTree(home, c.home);
      if (c.db) {
        await run("node", [bin, "zzz-setup"], { cwd: root, env: sandboxEnv(home) }).catch(() => {});
        if (typeof c.db === "string") {
          const db = new DatabaseSync(join(home, ".harnesstap", "harnesstap.db"));
          db.exec(c.db);
          db.close();
        }
      }
      const before = { ...snapshot(root, "[ROOT]"), ...snapshot(home, "[HOME]") };
      let stdout = "", stderr = "", code = 0;
      try {
        ({ stdout, stderr } = await run("node", [bin, ...c.args], {
          timeout: 60000,
          cwd: join(root, c.cwd ?? ""),
          env: sandboxEnv(home, c.env),
        }));
      } catch (error) {
        ({ stdout = "", stderr = "" } = error);
        code = error.code ?? 1;
      }
      const after = { ...snapshot(root, "[ROOT]"), ...snapshot(home, "[HOME]") };
      const norm = (text) => text.replaceAll(root, "[ROOT]").replaceAll(home, "[HOME]");
      const changes = {};
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (before[key] !== after[key]) changes[key] = key in after ? (after[key] === null ? null : norm(after[key])) : "$deleted";
      }
      projectResults[i] = { ...c, stdout: norm(stdout), stderr: norm(stderr), code, changes, rows: dumpDb(home) };
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }
}
await Promise.all(Array.from({ length: 8 }, projectWorker));
writeFileSync(join(here, "fixtures", "projects.json"), `${JSON.stringify(projectResults, null, 1)}\n`);
console.log(`${projectResults.length} project runs`);
