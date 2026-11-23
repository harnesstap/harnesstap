// Records apm-policy.ts for tests/policy_fixtures.rs.
// Run from the repository root: bun rust/apm-rs/tests/make-policy-fixtures.ts
import { spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import * as pluginModel from "../../../src/models/plugin-model.ts";
import * as locator from "../../../src/services/plugin-origin-locator.ts";
import * as policy from "../../../src/services/apm-policy.ts";

let seed = 0x5eed1;
const rnd = (n: number) => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) % n;
};
const pick = <T>(a: readonly T[]): T => a[rnd(a.length)]!;
const some = <T>(a: readonly T[], max = 4): T[] => Array.from({ length: rnd(max + 1) }, () => pick(a));
const err = (e: unknown) => ({ name: (e as Error).name, message: (e as Error).message });
const run = (f: () => unknown) => {
  try {
    const v = f();
    return { ok: v === undefined ? null : v };
  } catch (e) {
    return { err: err(e) };
  }
};

// Pins
const hashes = ["sha256:AB12", "SHA384:x", "sha512:", "md5:x", "abc", "", "  ", " sha256:y ", ":x", "sha1:z"];
const algs = [undefined, null, "", "sha256", "SHA512", "md5", "sha1", "sha999", 5, true];
const pinValues: unknown[] = [undefined, null, "x", 5, [], [1], {}, { hash: 5 }];
for (let i = 0; i < 200; i++) {
  const v: Record<string, unknown> = {};
  if (rnd(6)) v.hash = pick(hashes);
  const a = pick(algs);
  if (a !== undefined) v.hash_algorithm = a;
  pinValues.push(v);
}
const pins = pinValues.map((value) => ({ value: value === undefined ? "$undefined" : value, ...run(() => policy.parseApmPolicyPin(value)) }));

// Hashes
const hashCases = [];
for (let i = 0; i < 60; i++) {
  const bytes = Array.from({ length: rnd(40) }, () => rnd(256));
  const algorithm = pick(["sha256", "sha384", "sha512"] as const);
  hashCases.push({ bytes, algorithm, hash: policy.hashPolicyBytes(new Uint8Array(bytes), algorithm) });
}
const matchPairs = [["a", "A"], [" a ", "a"], ["sha256:AB", "sha256:ab"], ["x", "y"], ["", " "], ["İ", "i̇"]].map(
  ([a, b]) => ({ a, b, match: policy.policyHashesMatch(a!, b!) }),
);

// Documents
const patterns = [
  "github.com/acme/*", "github.com/acme/**", "acme/*", "git", "catalog", "local", "marketplace", "./*", "../*",
  "*", "**", "github.com", "gitlab.com/**", "org/cat/*", "x@market", "@scope/*", "!foo", "{a,b}/*", "*/r",
  "h.example/o/r", "o/r", "server-*", "io.github/*", "mcp-[ab]", "?ilesystem", "+(a|b)", " ", "", "a/**/b",
  "registry.io/srv", "srv", "@org/srv", "file:///tmp/*",
];
const contentTypes = ["skill", "Skills", " agents ", "prompt", "rules", "mcp-server", "MCP_SERVER", "hooks", "bogus", ""];
const listOf = (pool: readonly unknown[]) => {
  const r = rnd(12);
  if (r === 0) return null;
  if (r === 1) return "notalist";
  if (r === 2) return [pick(pool), 5];
  return some(pool, 4);
};
const randomDoc = (): Record<string, unknown> => {
  const d: Record<string, unknown> = {};
  if (rnd(2)) d.name = pick(["org", "", 5, "x"]);
  if (rnd(3) === 0) d.version = pick(["1", 2, ""]);
  if (rnd(3) === 0) d.enforcement = pick(["off", "warn", "block", "block", "BLOCK", "", null, 1]);
  else d.enforcement = pick(["warn", "block"]);
  if (rnd(5) === 0) d.fetch_failure = pick(["warn", "block", "x", ""]);
  if (rnd(8) === 0) d.extends = pick(["", " ", "org/policy", 5]);
  for (let k = 0, n = rnd(10) === 0 ? 1 + rnd(3) : 0; k < n; k++) d[pick(["x-acme", "x-1", "unknown", "cache", "10", "2", "x-acme-thing", "security", "zeta", "Alpha"])] = 1;
  if (rnd(4)) {
    const deps: Record<string, unknown> = {};
    if (rnd(2)) deps.allow = listOf(patterns);
    if (rnd(2)) deps.deny = listOf(patterns);
    d.dependencies = rnd(15) === 0 ? "x" : deps;
  }
  if (rnd(2)) {
    const mcp: Record<string, unknown> = {};
    if (rnd(2)) mcp.allow = listOf(patterns);
    if (rnd(3) === 0) mcp.deny = listOf(patterns);
    if (rnd(2)) mcp.trust_transitive = pick([true, false, "yes", null]);
    d.mcp = mcp;
  }
  if (rnd(3) === 0) d.manifest = { content_types: { allow: rnd(4) ? some(contentTypes.filter((c) => c !== "bogus" && c !== ""), 3) : listOf(contentTypes) } };
  if (rnd(5) === 0) {
    d.executables = pick([null, "x", {}, { deny: listOf(["rm", "curl"]), enforce: some(["a", "b"]), recommend: some(["b", "c"]), deny_all: pick([true, false, "no", null, undefined]), require: some(["git"]) }]);
  }
  if (rnd(6) === 0) d.bin_deploy = pick([null, 5, {}, { deny_all: pick([true, 1, null]) }, { deny: listOf(["x", "y"]) }]);
  return d;
};
const rawDocs = [
  "", "- a\n- b\n", "plain", "name: [unclosed\n", "a: 1\na: 2\n", "x: &a 1\ny: *a\n", "enforcement: block\n",
  "\uFEFFname: bom\n", "name: x\n---\nname: y\n", "~", "dependencies:\n  allow: []\n",
];
const documents = [];
const validDocs: unknown[] = [];
for (let i = 0; i < 600; i++) {
  const raw = i < rawDocs.length ? rawDocs[i]! : stringify(randomDoc());
  const r = run(() => policy.parseApmPolicyDocument(raw, "/p/apm-policy.yml"));
  if ("ok" in r) validDocs.push(r.ok);
  documents.push({ raw, ...r });
}

// matchPolicyPattern
const candidatePool = [
  "github.com/acme/r", "acme/r", "github.com", "git", "catalog", "local", ".", "./", "./skills", "../up",
  "org/cat/slug", "marketplace", "x@market", "srv", "io.github/srv", "registry.io/srv", "@scope/pkg", "a/x/b",
  "file:///tmp/r", ".hidden/x",
];
const matches = [];
for (let i = 0; i < 1500; i++) {
  const pattern = pick(patterns);
  const candidates = some(candidatePool, 5);
  matches.push({ pattern, candidates, ...run(() => policy.matchPolicyPattern(pattern, candidates)) });
}

// Plans
const origins = ["https://github.com/acme/r.git", "git@GitHub.com:acme/r.git", "file:///tmp/r.git", "localhost/o/r", "h/o/r", "acme/r"];
const apmDep = () => {
  const kind = pick(["git", "git", "catalog", "marketplace", "local"]);
  const originRef = kind === "git" ? pick(origins) : kind === "catalog" ? pick(["org/cat/slug", "org/cat/other", "Org/cat/b", "_x/c/d"]) : kind === "marketplace" ? pick(["x@market", "y@market", "Y@market", "-z@m"]) : pick(["./skills", "../up", "./skills", "./Skills", "./_a"]);
  return { raw: originRef, sourceKind: kind, name: pick(["r", "slug", "x"]), originRef, applySelector: originRef };
};
const mcpDep = () => {
  const d: Record<string, unknown> = { raw: "x", name: pick(["srv", "other", "fs"]) };
  if (rnd(2)) d.registryId = pick(["io.github/srv", "registry.io/srv", "@org/srv"]);
  return d;
};
const lockEntry = () => {
  const e: Record<string, unknown> = {
    name: pick(["r", "slug", "x", "acme/r"]), version: "1.0.0", source: pick(["local", "git", "catalog", "marketplace"]),
    integrity: "", depth: pick([0, 1, 2, 1.5]), path: [],
  };
  if (rnd(3) === 0) e.repo_url = pick(["github.com/acme/r", "https://github.com/acme/r.git", "", "org/cat/slug"]);
  return e;
};
const pluginIds = ["p-git", "p-cat", "p-mkt", "p-none", "p-missing", "p-other", ""];
const locators: Record<string, unknown> = {
  "p-git": { kind: "git", url: "https://github.com/acme/r.git" },
  "p-cat": { kind: "catalog", org: "org", catalog: "cat", slug: "slug" },
  "p-mkt": { kind: "marketplace", ref: "x@market" },
  "p-none": null,
  "p-other": { kind: "local", path: "/x" },
};
spyOn(pluginModel, "getPluginById").mockImplementation(((id: string) => (id === "p-missing" ? undefined : { id })) as never);
spyOn(locator, "recoverOriginLocator").mockImplementation(((plugin: { id: string }) => locators[plugin.id] ?? null) as never);
const resourceTypes = ["skill", "agent", "command", "hook", "instruction", "rule", "mcp_server", "mcp_server", "mcp_server", "mcp_server", "permission", "env_var", "model_config", "plugin"];
const resource = () => ({
  id: "r", type: pick(resourceTypes), name: pick(["srv", "fs", "other", "x"]), description: "", content: "", metadata: {},
  source: "", namespace: "", origin_kind: "", origin_ref: pick(["", "", "io.github/srv"]), content_hash: "", content_blob_ref: "",
  created_at: "", updated_at: "",
});
const side = (depth: number) => ({ pluginName: "p", pluginVersion: "1", depth });

const emptyRoot = mkdtempSync(join(tmpdir(), "apm-policy-empty-"));
const plans = [];
for (let i = 0; i < 500; i++) {
  const audit = rnd(2) === 0;
  const apmDependencies = some([0, 0, 0, 0].map(apmDep), 3);
  const mcpDependencies = rnd(3) ? some([0, 0, 0].map(mcpDep), 2) : undefined;
  let input: Record<string, unknown>;
  let plan;
  if (audit) {
    const lock = rnd(3) === 0 ? undefined : {
      plugins: some([0, 0, 0, 0].map(lockEntry), 3),
      ...(rnd(2) ? { mcp_servers: some([{ name: "srv" }, { name: "fs" }, { name: "other" }], 2) } : {}),
    };
    input = { apmDependencies, mcpDependencies, lock };
    plan = policy.buildAuditInstallPlan({ projectRoot: emptyRoot, apmDependencies, mcpDependencies: mcpDependencies as never, lock: lock as never });
  } else {
    const selected = some([0, 1, 1, 2].map((depth) => ({
      name: pick(["r", "slug", "x", "acme"]), version: "1.0.0", pluginId: pick(pluginIds), depth, declarationIndex: 0,
      constraints: [], reason: "mediation", path: [], source: pick(["local", "git", "catalog", "marketplace"]),
    })), 4);
    const resources = some([0, 0, 0, 0, 0].map(resource), 4);
    const decisions = some([
      { key: "mcp_server:srv", winner: side(2), losers: [], reason: "only-candidate" },
      { key: "mcp_server:fs", winner: side(1), losers: [], reason: "only-candidate" },
      { key: "mcp_server:srv", winner: side(0), losers: [], reason: "only-candidate" },
      { key: "mcp_server:other", winner: side(1), losers: [], reason: "only-candidate" },
    ], 4);
    const gitLocks = some([{ name: "r", repo_url: "git@github.com:acme/r.git" }, { name: "x", repo_url: "" }, { name: "r", repo_url: "h/o/r" }], 2);
    input = { selected, decisions, resources, apmDependencies, mcpDependencies, gitLocks };
    plan = policy.buildApplyInstallPlan({ resolution: { selected, decisions } as never, resources: resources as never, apmDependencies: apmDependencies as never, mcpDependencies: mcpDependencies as never, gitLocks });
  }
  const evaluations = Array.from({ length: 3 }, () => {
    const doc = pick(validDocs) as never;
    return { policy: doc, ...run(() => policy.evaluatePolicy(doc, plan)) };
  });
  plans.push({ audit, input, plan, evaluations });
}

// loadProjectPolicy, evaluationFromLoad, readManifestPolicyPin
const base = mkdtempSync(join(tmpdir(), "apm-policy-load-"));
const loads = [];
const goodRaws = documents.filter((d) => "ok" in d).map((d) => d.raw);
for (let i = 0; i < 800; i++) {
  const root = join(base, `p${i}`);
  mkdirSync(join(root, "sub"), { recursive: true });
  const content = rnd(3) ? pick(goodRaws) : pick([...documents.slice(0, 40).map((d) => d.raw), "enforcement: block\ndependencies:\n  allow: [git]\n"]);
  const where = rnd(4);
  if (where === 1) writeFileSync(join(root, "apm-policy.yml"), content);
  if (where === 2) writeFileSync(join(root, "sub", "custom.yml"), content);
  if (where === 3) mkdirSync(join(root, "apm-policy.yml"));
  const realHash = policy.hashPolicyBytes(Buffer.from(content), "sha256");
  const pin = rnd(3) ? undefined : pick([
    { hash: realHash, algorithm: "sha256" }, { hash: realHash.toUpperCase(), algorithm: "sha256" },
    { hash: "sha256:00", algorithm: "sha256" }, { hash: "x", algorithm: "sha512" },
  ]);
  const policyPath = pick([undefined, undefined, undefined, undefined, "sub/custom.yml", "", " ", "sub/custom.yml", "./sub/custom.yml", "../escape.yml", join(root, "sub", "custom.yml"), "/etc/passwd", ".", "sub/../apm-policy.yml", "missing.yml"]);
  const requirePolicy = rnd(3) === 0;
  const apmYml = rnd(3) === 0 ? pick(["policy:\n  hash: sha256:ab\n", "policy: 5\n", "name: x\n", "[", "policy:\n  hash: x\n  hash_algorithm: SHA384\n"]) : null;
  if (apmYml !== null) writeFileSync(join(root, "apm.yml"), apmYml);
  const options = { projectRoot: root, ...(policyPath !== undefined ? { policyPath } : {}), ...(pin ? { pin } : {}), ...(requirePolicy ? { requirePolicy } : {}) };
  const loaded = run(() => policy.loadProjectPolicy(options as never));
  const plan = pick(plans).plan;
  const evaluation = "ok" in loaded ? run(() => policy.evaluationFromLoad(loaded.ok as never, plan)) : null;
  const manifestPin = run(() => policy.readManifestPolicyPin(root));
  const strip = (v: unknown) => JSON.parse(JSON.stringify(v ?? null).replaceAll(root, "<root>"));
  loads.push({ index: i, where, content, pin: pin ?? null, policyPath: policyPath === undefined ? null : policyPath.replaceAll(root, "<root>"), requirePolicy, apmYml, loaded: strip(loaded), plan, evaluation: strip(evaluation), manifestPin: strip(manifestPin) });
}
rmSync(base, { recursive: true, force: true });
rmSync(emptyRoot, { recursive: true, force: true });

const violationPool = [
  { code: "a", message: "first" }, { code: "b", message: "second", subject: "s" }, { code: "c", message: "third\nline" },
];
const formats = Array.from({ length: 30 }, () => {
  const v = some(violationPool, 4);
  return { violations: v, text: policy.formatPolicyViolations(v), assert: run(() => policy.assertPolicyAllowsApply({ blocks: rnd(2) === 0, violations: v } as never)) };
});

writeFileSync(
  new URL("./fixtures/policy.json", import.meta.url),
  JSON.stringify({ pins, hashCases, matchPairs, documents, matches, plans, loads, formats }),
);
const count = (xs: Array<Record<string, unknown>>) => xs.filter((x) => "err" in x).length;
console.log(documents.length, "documents,", count(documents), "errors;", matches.length, "matches;", plans.length, "plans;", loads.length, "loads");
