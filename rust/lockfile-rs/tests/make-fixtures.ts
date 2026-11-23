// Records src/services/lockfile.ts, as fixtures for tests/fixtures.rs.
// Run from the repository root: bun rust/lockfile-rs/tests/make-fixtures.ts
//
// The plugin model is not ported yet, so `getPluginById` and `getPluginResources` are spied on
// and answer from each scenario's plugin table. What lockfile.ts gets from the two unported
// helpers it calls (`recoverOriginLocator`, `canonicalApmRepoUrl`) is recorded per plugin, and
// the Rust test answers with those recordings.
import { setSystemTime, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as pluginModel from "../../../src/models/plugin-model.ts";
import * as lockfile from "../../../src/services/lockfile.ts";
import { recoverOriginLocator } from "../../../src/services/plugin-origin-locator.ts";
import { canonicalApmRepoUrl } from "../../../src/services/apm-git-resolve.ts";
import { PACKAGE_VERSION } from "../../../src/version.ts";

let seed = 0x10cf11e;
const rnd = (n: number) => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) % n;
};
const pick = <T>(a: readonly T[]): T => a[rnd(a.length)]!;

let plugins: Record<string, Record<string, unknown>> = {};
let pluginResources: Record<string, unknown[]> = {};
spyOn(pluginModel, "getPluginById").mockImplementation(((id: string) => plugins[id]) as never);
spyOn(pluginModel, "getPluginResources").mockImplementation(
  ((id: string) => pluginResources[id] ?? []) as never,
);

const run = (f: () => unknown) => {
  try {
    const v = f();
    return { ok: v === undefined ? "$undefined" : v };
  } catch (e) {
    return { err: { name: (e as Error).name, message: (e as Error).message } };
  }
};

const resourceTypes = ["skill", "rule", "mcp_server", "env_var", "agent", "command"];
const names = ["alpha", "beta", "Beta", "gamma", "10", "2", "é-skill", "zeta"];
let nextId = 0;
const resource = () => {
  const type = pick(resourceTypes);
  const metadata: Record<string, unknown> = {};
  if (type === "env_var" && rnd(2)) metadata.key = pick(["API_KEY", "", "TOKEN"]);
  if (type === "mcp_server") {
    if (rnd(2)) metadata.transport = pick(["stdio", "http", "", 0, 1]);
    if (rnd(2)) metadata.command = pick(["npx", "", "node server.js"]);
    if (rnd(2)) metadata.url = pick(["https://mcp.example.com", ""]);
  }
  if (rnd(3) === 0) metadata.zeta = { b: [1, "x"], a: null, "1": true };
  return {
    id: `r${nextId++}`,
    type,
    name: pick(names),
    description: "",
    content: pick(["", "body", "line\r\nline", "ünïcode 😀"]),
    // A null metadata on env_var and mcp_server resources makes the original throw a TypeError.
    metadata: rnd(30) === 0 ? null : metadata,
    source: "local",
    namespace: "",
    origin_kind: "",
    origin_ref: "",
    content_hash: rnd(3) === 0 ? pick(["abc123", "sha256:ffff"]) : "",
    content_blob_ref: "",
    created_at: "",
    updated_at: "",
  };
};

const locators = [
  "", "", "https://github.com/Org/Repo.git", "https://github.com/Org/Repo.git#v1.2.0",
  "git@github.com:org/repo.git", "git@github.com:org/repo.git#main", "ssh://git@github.com:22/o/r.git",
  "dep@market", "org/catalog/slug", "github:org/repo", "file:///tmp/repo.git#abc1234",
];
const plugin = (id: string) => ({
  id,
  name: `plugin-${id}`,
  origin: pick(["authored", "upstream", "catalog", "imported"]),
  origin_locator: pick(locators),
  origin_fingerprint: pick(["", "0123456789abcdef0123456789abcdef01234567", "deadbeef"]),
  origin_fingerprint_kind: pick(["git_sha", "git_sha", "content_hash", undefined]),
  org_slug: pick(["", "org"]),
  catalog_slug: pick(["", "cat"]),
  ap_name: "",
});

const oracle = (id: string) => {
  const p = plugins[id];
  if (!p) return { plugin: null };
  const locator = recoverOriginLocator(p as never);
  return {
    plugin: {
      origin_locator: p.origin_locator ?? null,
      origin_fingerprint: p.origin_fingerprint ?? null,
      origin_fingerprint_kind: p.origin_fingerprint_kind ?? null,
    },
    locator,
    canonical: locator?.kind === "git" ? { [locator.url]: canonicalApmRepoUrl(locator.url) } : {},
  };
};

const scenarios: unknown[] = [];
const tmpRoot = mkdtempSync(join(tmpdir(), "lockfile-fixtures-"));

for (let s = 0; s < 250; s++) {
  plugins = {};
  pluginResources = {};
  const ids = ["p1", "p2", "p3", "p4", "p5"];
  for (const id of ids) {
    if (rnd(6) !== 0) plugins[id] = plugin(id);
    pluginResources[id] = Array.from({ length: rnd(4) }, resource);
  }
  const rootName = pick(["root", "my-profile"]);
  const selected = [
    { name: rootName, version: "1.0.0", pluginId: "p0", depth: 0, declarationIndex: 0, constraints: [], reason: "root", path: [rootName], source: "local" },
    ...Array.from({ length: rnd(5) }, (_, i) => {
      const name = pick(["dep-a", "dep-b", "Dep-C", "dep-d", "zed", "10-x"]);
      const depth = 1 + rnd(3);
      return {
        name,
        version: pick(["1.0.0", "2.1.0", "0.0.1", "", "abc1234"]),
        pluginId: pick(ids),
        depth,
        declarationIndex: i + 1,
        constraints: [],
        reason: "mediation",
        path: [rootName, ...Array.from({ length: depth - 1 }, (_, k) => `mid${k}`), name],
        source: pick(["local", "marketplace", "git", "catalog"]),
      };
    }),
  ];
  const result = {
    root: { name: rootName, version: "1.0.0", pluginId: "p0", ephemeral: false },
    selected,
    resources: Array.from({ length: rnd(5) }, resource),
    decisions: [],
    warnings: [],
  };
  const extras: Record<string, unknown> = {};
  if (rnd(2)) extras.environment = pick(["", "prod", "dev"]);
  if (rnd(2)) {
    extras.deployedFiles = Array.from({ length: rnd(5) }, () => ({
      path: pick(["b.md", "a.md", "A.md", "10", "2", "dir/x.md", "__proto__", "é.md", "a.md"]),
      content: pick(["x", "x\r\ny", "", "😀"]),
    }));
  }
  if (rnd(2)) {
    extras.gitLocks = Array.from({ length: rnd(3) }, () => {
      const lock: Record<string, unknown> = {
        name: pick(["dep-a", "dep-b", "zed", "none"]),
        repo_url: pick(["github.com/o/r", "github.com/a/b", ""]),
        resolved_commit: "abcdef0",
      };
      if (rnd(2)) lock.resolved_ref = pick(["main", "v1"]);
      if (rnd(2)) lock.constraint = "^1.0.0";
      if (rnd(2)) lock.resolved_tag = "v1.0.0";
      if (rnd(2)) lock.virtual_path = "skills/x";
      if (rnd(2)) lock.declared_license = pick(["MIT", ""]);
      return lock;
    });
  }
  if (rnd(2)) extras.execStatuses = { [pick(["dep-a", "zed"])]: pick(["deployed", "denied", "gated_pending_approval", "absent"]) };
  if (rnd(2)) extras.declaredLicenses = { [pick(["dep-a", "dep-b", "zed"])]: pick(["Apache-2.0", ""]) };
  // A license from declaredLicenses that a git lock without one must not erase.
  const locks = extras.gitLocks as Array<{ name: string }> | undefined;
  if (locks?.length && rnd(2)) {
    extras.declaredLicenses = { ...(extras.declaredLicenses as object), [locks[0]!.name]: "BSD-3-Clause" };
  }

  const now = 1767225600000 + s * 1000;
  setSystemTime(new Date(now));
  const calls: unknown[] = [];
  const built = run(() => lockfile.lockfileFromResolution(result as never, extras as never));
  calls.push({ fn: "lockfileFromResolution", ...built });
  let yaml: string | null = null;
  let reread: unknown = null;
  if ("ok" in built) {
    const lock = built.ok as never;
    const dir = join(tmpRoot, `s${s}`);
    mkdirSync(dir, { recursive: true });
    calls.push({ fn: "writeLockfile", ...run(() => lockfile.writeLockfile(dir, lock)) });
    yaml = readFileSync(lockfile.lockfilePath(dir), "utf8");
    reread = run(() => lockfile.readLockfile(dir));
    calls.push({ fn: "lockfileMatchesResolution", ...run(() => lockfile.lockfileMatchesResolution(lock, result as never)) });
    calls.push({ fn: "lockIsUsable", ...run(() => lockfile.lockIsUsable(lock, "root")) });
    calls.push({ fn: "compareLockToResolution", ...run(() => lockfile.compareLockToResolution(lock, result as never)) });
    calls.push({ fn: "lockedVersionsFrom", ...run(() => [...lockfile.lockedVersionsFrom(lock).entries()]) });
    // The same lock against a different resolution.
    const other = { ...result, root: { ...result.root, name: rootName }, selected: selected.map((p) => (rnd(3) === 0 ? { ...p, version: "9.9.9" } : p)).filter(() => rnd(5) !== 0), resources: result.resources.slice(1) };
    calls.push({ fn: "compareLockToResolution", other, ...run(() => lockfile.compareLockToResolution(lock, other as never)) });
    calls.push({ fn: "lockfileMatchesResolution", other, ...run(() => lockfile.lockfileMatchesResolution(lock, other as never)) });
  }
  scenarios.push({
    now: new Date(now).toISOString(),
    result,
    extras,
    plugins: Object.fromEntries(ids.map((id) => [id, oracle(id)])),
    pluginResources,
    calls,
    yaml,
    reread,
  });
}

// readLockfile on hand-written files.
const reads: unknown[] = [];
const texts = [
  "", "[]\n", "a\n", "lockfile_version: 1\n", "lockfile_version: '1'\n", "lockfile_version: 2\n", "lockfile_version: 3\n",
  "lockfile_version: 1.0\n", "lockfile_version: true\n", "lockfile_version: [1]\n", "root: x\n", "lockfile_version:\n",
  "lockfile_version: \"\"\n", "lockfile_version: [1, 2]\n", "lockfile_version: {}\n", "a: [\n",
  "lockfile_version: 1\nroot: 5\nresource_map_hash: [a, b]\ngenerated_at: 2026-01-01\nresolved_at: x\nplugins:\n  - name: a\n    version: 1.0\n    source: registry\n    depth: '3'\n    path: [r, 1, null, true]\n  - just-a-string\n  - name: b\n    source: weird\n    depth: abc\n    path: notarray\n    integrity: null\n    content_hash: h\n    exec_status: denied\n    declared_license: '  MIT  '\n  - {}\n",
  "lockfile_version: 1\ndependencies:\n  - name: d\n    version: 2\n    depth: 0x10\n    content_hash: c\n    repo_url: r\n    resolved_commit: abc\n    resolved_ref: main\n    constraint: '^1'\n    resolved_tag: v1\n    virtual_path: vp\n    exec_status: nope\n    declared_license: '   '\n  - name: e\n    depth: ''\n  - name: f\n    depth: ' 12 '\n  - name: g\n    depth: [7]\n  - name: h\n    depth: {}\n  - name: i\n    depth: true\n  - name: j\n    depth: 1e3\n  - name: k\n    depth: Infinity\n  - name: l\n    depth: 0b11\n",
  "lockfile_version: 1\nplugins: []\ndependencies:\n  - name: only-dep\n",
  "lockfile_version: 1\nmcp_servers:\n  - name: m\n    transport: stdio\n    command: 5\n  - x\n  - url: https://a\nlocal_deployed_file_hashes:\n  b: 1\n  a: sha256:x\n  10: y\n  2: [z]\n  __proto__: p\nenvironment: prod\n",
  "lockfile_version: 1\nmcp_servers: []\nlocal_deployed_file_hashes: []\nenvironment: 5\n",
  "lockfile_version: 1\nlocal_deployed_file_hashes: {}\n",
  "lockfile_version: 1\na: 1\na: 2\n",
];
for (const text of texts) {
  const dir = join(tmpRoot, `read${reads.length}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(lockfile.lockfilePath(dir), text);
  const res = run(() => lockfile.readLockfile(dir));
  if ("err" in res) (res.err as { message: string }).message = (res.err as { message: string }).message.replaceAll(dir, "<dir>");
  reads.push({ text, ...res });
}
reads.push({ text: null, ...run(() => lockfile.readLockfile(join(tmpRoot, "missing"))) });

// diffDeployedFileHashes and verifyDeployedFileHashes.
const diffs: unknown[] = [];
const h = (s: string) => lockfile.sha256Envelope(s.replace(/\r\n/g, "\n"));
for (let i = 0; i < 150; i++) {
  // "toString" finds Object.prototype.toString in the planned hashes, and the original throws.
  const paths = ["a.md", "b.md", "dir/c.md", "../up.md", "/abs.md", "x\\..\\y", "10", "2", "B.md"];
  if (rnd(10) === 0) paths.push("toString");
  const expected: Record<string, string> = {};
  for (let k = 0, n = rnd(5); k < n; k++) {
    const p = pick(paths);
    expected[p] = pick([h("x"), h("y"), h("x").toUpperCase().replace("SHA256:", "SHA256:"), h("x").slice(7), "", "sha256:00"]);
  }
  const files = Array.from({ length: rnd(4) }, () => ({ path: pick(paths.filter((p) => p !== "toString")), content: pick(["x", "y", "x\r\n", ""]) }));
  const disk = Array.from({ length: rnd(3) }, () => ({ path: pick(["a.md", "b.md", "dir/c.md", "10"]), content: pick(["x", "y"]) }));
  const withRoot = rnd(2) === 0;
  const root = join(tmpRoot, `diff${i}`);
  mkdirSync(root, { recursive: true });
  for (const f of disk) {
    mkdirSync(dirname(join(root, f.path)), { recursive: true });
    writeFileSync(join(root, f.path), f.content);
  }
  // Sometimes b.md is a directory: it exists, but reading it fails.
  const dirB = rnd(6) === 0 && !disk.some((f) => f.path === "b.md");
  if (dirB) mkdirSync(join(root, "b.md"), { recursive: true });
  const options = withRoot ? { rootPath: root } : {};
  diffs.push({
    expected: Object.entries(expected),
    files,
    disk,
    dirB,
    withRoot,
    diff: run(() => lockfile.diffDeployedFileHashes(expected, files, options)),
    verify: run(() => lockfile.verifyDeployedFileHashes(expected, files, options)),
  });
}

const misc = {
  packageVersion: PACKAGE_VERSION,
  envelopes: ["", "abc", "ünïcode", "a\r\nb"].map((s) => [s, lockfile.sha256Envelope(s)]),
};
rmSync(tmpRoot, { recursive: true, force: true });
writeFileSync(new URL("./fixtures/lockfile.json", import.meta.url), JSON.stringify({ misc, scenarios, reads, diffs }));
console.log(scenarios.length, "scenarios,", reads.length, "reads,", diffs.length, "diffs");
