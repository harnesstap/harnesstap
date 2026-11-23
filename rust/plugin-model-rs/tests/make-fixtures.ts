// Records what the original's plugin model does, as fixtures for tests/fixtures.rs.
// Run from the repository root: bun rust/plugin-model-rs/tests/make-fixtures.ts
//
// Same harness as rust/models-rs/tests/make-fixtures.ts: each scenario is a
// list of calls against a fresh database, the clock is pinned per call, ULIDs
// are renamed in order of appearance, and arguments can refer to earlier
// results. The plugin-composition, plugin-extends and claude-plugin-pins
// functions the model calls are replaced (spyOn) by small database-only
// versions; tests/fixtures.rs implements the same ones behind
// `PluginComposition`.
import { setSystemTime, spyOn } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { ulid } from "ulid";
import { closeDb, getDb } from "../../../src/db/connection.ts";
import { initializeSchema } from "../../../src/db/schema.ts";
import * as model from "../../../src/models/plugin-model.ts";
import { mapResourceRow } from "../../../src/models/resource.ts";
import * as composition from "../../../src/services/plugin-composition.ts";
import * as extendsSvc from "../../../src/services/plugin-extends.ts";
import * as pins from "../../../src/services/claude-plugin-pins.ts";
import * as upstream from "../../../src/services/plugin-upstream.ts";
import * as names from "../../../src/services/agent-plugins/name.ts";
import * as versioning from "../../../src/services/plugin-versioning.ts";
import * as origin from "../../../src/services/plugin-origin.ts";
import * as dependency from "../../../src/services/plugin-dependency.ts";
import * as resolveIndex from "../../../src/services/resolve/index.ts";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const HOME = "/tmp/ht-plugin-model-fixture";
const BASE = Date.parse("2026-01-01T00:00:00.000Z");
type Op = { fn: string; args: unknown[] };

// --- The composition stand-ins (mirrored in tests/fixtures.rs) ---
type Res = ReturnType<typeof model.getPluginResources>[number];
const refs = (pluginId: string) =>
  model
    .getPluginResources(pluginId)
    .filter((r: Res) => r.type === "plugin")
    .map((r: Res) => ({
      dependency_name: r.name,
      version_constraint: String((r.metadata as Record<string, unknown>).version_constraint ?? "latest"),
      resource: r,
    }));
spyOn(extendsSvc, "getComposedPluginResources").mockImplementation(((id: string) => model.getPluginResources(id)) as never);
spyOn(extendsSvc, "listComposedDependencies").mockImplementation(((id: string) =>
  refs(id).map((r) => ({ ref: r.dependency_name, version_constraint: r.version_constraint, resource: r.resource }))) as never);
spyOn(composition, "listAttachedPluginRefs").mockImplementation(refs as never);
spyOn(composition, "ensurePluginResource").mockImplementation(((selector: string, opts?: { versionConstraint?: string }) => {
  const db = getDb();
  const name = selector.replace(/^plugin:/, "");
  const metadata = JSON.stringify(opts?.versionConstraint ? { version_constraint: opts.versionConstraint } : {});
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT id FROM resources WHERE type = 'plugin' AND name = ?").get(name) as { id: string } | undefined;
  if (existing) {
    db.prepare("UPDATE resources SET metadata = ?, updated_at = ? WHERE id = ?").run(metadata, now, existing.id);
  } else {
    db.prepare("INSERT INTO resources (id, type, name, metadata, created_at, updated_at) VALUES (?, 'plugin', ?, ?, ?, ?)").run(ulid(), name, metadata, now, now);
  }
  return mapResourceRow(db.prepare("SELECT * FROM resources WHERE type = 'plugin' AND name = ?").get(name) as never);
}) as never);
spyOn(pins, "claudeConfigFromPluginPins").mockImplementation(((p: Array<{ ref: string; version_constraint: string }>) =>
  p.length === 0 ? undefined : { plugins: p.map((x) => ({ id: x.ref, version: x.version_constraint, enabled: true })) }) as never);

// resolveComposition until services/resolve is ported: the root's plugin-typed
// attachments at depth 1; a root named broken* does not resolve.
spyOn(resolveIndex, "resolveComposition").mockImplementation(((input: { rootSelectors: string[] }) => {
  const root = model.resolvePluginSelector(input.rootSelectors[0]!);
  if (!root || root.name.startsWith("broken")) throw new Error("unresolvable");
  return {
    selected: [
      { name: root.name, version: root.version, depth: 0 },
      ...refs(root.id).map((r) => ({ name: r.dependency_name, version: r.version_constraint, depth: 1 })),
    ],
  };
}) as never);
spyOn(console, "error").mockImplementation(() => {});

const fullResource = (r: Record<string, unknown>) => ({
  description: "", content: "", source: "", namespace: "", origin_kind: "manual", origin_ref: "",
  content_hash: "", content_blob_ref: "", created_at: T, updated_at: T, ...r,
});

const fns: Record<string, (...args: never[]) => unknown> = {
  isFrozenPlugin: model.isFrozenPlugin,
  mergePluginsById: model.mergePluginsById,
  createPlugin: model.createPlugin,
  stampPluginOrigin: model.stampPluginOrigin,
  assertNoFrozenWorkingVersion: model.assertNoFrozenWorkingVersion,
  bumpPluginWorkingVersion: model.bumpPluginWorkingVersion,
  updatePluginPublishedIdentity: model.updatePluginPublishedIdentity,
  updatePluginCatalogIdentity: model.updatePluginCatalogIdentity,
  parsePluginSelectorString: model.parsePluginSelectorString,
  getPluginById: model.getPluginById,
  getPlugin: model.getPlugin,
  getPluginByName: model.getPluginByName,
  getPluginByPublishedIdentity: model.getPluginByPublishedIdentity,
  getPluginByCatalogVersion: model.getPluginByCatalogVersion,
  findPluginForCatalogInstall: model.findPluginForCatalogInstall,
  listLatestPublishedPluginsBySlug: model.listLatestPublishedPluginsBySlug,
  formatPublishedPluginSelector: model.formatPublishedPluginSelector,
  isSamePublishedPluginIdentity: model.isSamePublishedPluginIdentity,
  listPlugins: model.listPlugins,
  listPluginsAttachingResource: model.listPluginsAttachingResource,
  deletePlugin: model.deletePlugin,
  addResourceToPlugin: model.addResourceToPlugin,
  setPluginResourceHarnessScope: model.setPluginResourceHarnessScope,
  getPluginResourceHarnessScope: model.getPluginResourceHarnessScope,
  removeResourceFromPlugin: model.removeResourceFromPlugin,
  setPluginResourceOrder: model.setPluginResourceOrder,
  touchPluginUpdatedAt: model.touchPluginUpdatedAt,
  getPluginResources: model.getPluginResources,
  ensurePluginClaudeMarketplace: model.ensurePluginClaudeMarketplace,
  syncClaudeMarketplacePluginsAfterAdd: model.syncClaudeMarketplacePluginsAfterAdd,
  syncClaudeMarketplacePluginsAfterRemove: model.syncClaudeMarketplacePluginsAfterRemove,
  addDependencyToPlugin: model.addDependencyToPlugin,
  listPluginDependencies: model.listPluginDependencies,
  removeDependencyFromPlugin: model.removeDependencyFromPlugin,
  setPluginDefaultEnvironment: model.setPluginDefaultEnvironment,
  setPluginTags: model.setPluginTags,
  setPluginApName: model.setPluginApName,
  setPluginSpecMetadata: model.setPluginSpecMetadata,
  readPluginOpaqueExtensions: model.readPluginOpaqueExtensions,
  resolveApName: model.resolveApName,
  updatePluginName: model.updatePluginName,
  updatePluginDescription: model.updatePluginDescription,
  createPluginFromSources: model.createPluginFromSources,
  resolvePluginSelector: model.resolvePluginSelector,
  listPluginVersions: model.listPluginVersions,
  upstreamFromRow: upstream.upstreamFromRow,
  isCatalogUpstreamRef: upstream.isCatalogUpstreamRef,
  upstreamRange: upstream.upstreamRange,
  buildUpstream: upstream.buildUpstream,
  upstreamRefBase: upstream.upstreamRefBase,
  formatUpstreamLabel: upstream.formatUpstreamLabel,
  exportableUpstream: upstream.exportableUpstream,
  parseUpstream: upstream.parseUpstream,
  setPluginUpstream: upstream.setPluginUpstream,
  isValidApName: names.isValidApName,
  isValidAgentSkillName: names.isValidAgentSkillName,
  slugifyAgentSkillName: names.slugifyAgentSkillName,
  slugifyApName: names.slugifyApName,
  formatPluginVersionLabel: versioning.formatPluginVersionLabel,
  listPluginVersionHistory: versioning.listPluginVersionHistory,
  markPluginClean: versioning.markPluginClean,
  markPluginDirty: versioning.markPluginDirty,
  cutPluginVersion: versioning.cutPluginVersion,
  assertPluginsCleanForShare: versioning.assertPluginsCleanForShare,
  getFrozenResolvedSet: versioning.getFrozenResolvedSet,
  formatPluginRollbackConfirmMessage: versioning.formatPluginRollbackConfirmMessage,
  rollbackPluginVersion: versioning.rollbackPluginVersion,
  getPluginOrigin: origin.getPluginOrigin,
  setPluginOrigin: origin.setPluginOrigin,
  assertAuthored: origin.assertAuthored,
  assertSyncable: origin.assertSyncable,
  parseDependencyRef: dependency.parseDependencyRef,
  ensureDependencyResource: dependency.ensureDependencyResource,
  addDependency: dependency.addDependency,
  dependenciesFromResources: dependency.dependenciesFromResources,
  listDependencies: dependency.listDependencies,
  removeDependency: dependency.removeDependency,
  __exec: ((sql: string) => getDb().exec(sql)) as never,
  __query: ((sql: string) => (getDb().prepare(sql).all() as Record<string, unknown>[]).map((row) => Object.values(row))) as never,
  __writeConfig: ((text: string) => {
    mkdirSync(HOME, { recursive: true });
    writeFileSync(join(HOME, "config.json"), text);
  }) as never,
};

/** `{"$ref": [i, "field"]}` is field of result i ("" for the whole result). */
function resolve(value: unknown, results: unknown[]): unknown {
  if (Array.isArray(value)) return value.map((v) => resolve(v, results));
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if ("$ref" in o) {
      const [i, field] = o.$ref as [number, string];
      if (field === "") return results[i];
      return field.split(".").reduce<unknown>(
        (acc, key) => (acc as Record<string, unknown> | undefined)?.[key],
        results[i],
      );
    }
    if ("$undef" in o) return undefined;
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, resolve(v, results)]));
  }
  return value;
}

function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function dump(): Record<string, unknown[]> {
  const db = getDb();
  const out: Record<string, unknown[]> = {};
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;
  for (const { name } of tables) {
    if (name === "schema_version") continue;
    const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
    if (rows.length > 0) out[name] = plain(rows) as unknown[];
  }
  return out;
}

const T = "2026-01-01T00:00:00.000Z";
const ref = (i: number, field = "id") => ({ $ref: [i, field] });
const insertPlugin = (id: string, name: string, version: string, extra: Record<string, string | number | null> = {}) => {
  const cols = ["id", "name", "version", "created_at", "updated_at", ...Object.keys(extra)];
  const vals = [id, name, version, T, T, ...Object.values(extra)].map((v) =>
    v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`);
  return { fn: "__exec", args: [`INSERT INTO plugins (${cols.join(", ")}) VALUES (${vals.join(", ")})`] };
};
const insertResource = (id: string, type: string, name: string, metadata = "{}") =>
  ({ fn: "__exec", args: [`INSERT INTO resources (id, type, name, metadata, content, created_at, updated_at) VALUES ('${id}', '${type}', '${name}', '${metadata}', 'body of ${name}', '${T}', '${T}')`] });

// Every scenario starts with these rows, outside the recorded calls.
const SETUP = `INSERT INTO environments (id, name, created_at, updated_at) VALUES ('env1', 'one', '${T}', '${T}'), ('e1', 'e-one', '${T}', '${T}'), ('e2', 'e-two', '${T}', '${T}')`;

const scenarios: Array<{ name: string; ops: Op[] }> = [
  {
    name: "create and select",
    ops: [
      { fn: "createPlugin", args: [{ name: "alpha" }] },
      { fn: "createPlugin", args: [{ name: "alpha", version: "1.2.0", description: "d", tags: ["a", "b"], claude: { marketplaces: { m: { source: "github", repo: "o/r" } } }, needs: ["TOKEN"], org_slug: "", catalog_slug: "", origin: "catalog" }] },
      { fn: "createPlugin", args: [{ name: "alpha", version: "2.0.0-beta.1", claude: {}, needs: [] }] },
      { fn: "createPlugin", args: [{ name: "beta", version: "latest" }] },
      { fn: "createPlugin", args: [{ name: "beta", version: "1.0" }] },
      { fn: "createPlugin", args: [{ name: "global default", version: "1.0.0" }] },
      { fn: "getPluginById", args: [ref(1)] },
      { fn: "getPluginById", args: ["nope"] },
      { fn: "getPlugin", args: [ref(0)] },
      { fn: "getPlugin", args: ["alpha"] },
      { fn: "getPlugin", args: ["alpha@1.0.0"] },
      { fn: "getPlugin", args: ["alpha@^1.0.0"] },
      { fn: "getPlugin", args: ["alpha@>=2.0.0-0"] },
      { fn: "getPlugin", args: ["alpha@latest"] },
      { fn: "getPlugin", args: ["alpha@ 1.2.0 "] },
      { fn: "getPlugin", args: ["alpha@9.9.9"] },
      { fn: "getPlugin", args: ["alpha@not a range"] },
      { fn: "getPlugin", args: ["alpha@deadbeef1"] },
      { fn: "getPlugin", args: ["beta@latest"] },
      { fn: "getPlugin", args: ["beta@1.0"] },
      { fn: "getPlugin", args: ["beta"] },
      { fn: "getPlugin", args: ["@scope"] },
      { fn: "getPlugin", args: ["missing"] },
      { fn: "getPluginByName", args: ["alpha"] },
      { fn: "getPluginByName", args: ["alpha", "1.2.0"] },
      { fn: "getPluginByName", args: ["alpha", ""] },
      { fn: "getPluginByName", args: ["alpha", "3.0.0"] },
      { fn: "resolvePluginSelector", args: [ref(1)] },
      { fn: "resolvePluginSelector", args: ["alpha@1.2.0"] },
      { fn: "resolvePluginSelector", args: ["alpha@^1"] },
      { fn: "resolvePluginSelector", args: ["beta"] },
      { fn: "resolvePluginSelector", args: ["default"] },
      { fn: "resolvePluginSelector", args: ["ABCDEFGHJKMNPQRSTVWXYZ0123"] },
      { fn: "resolvePluginSelector", args: ["gamma"] },
      { fn: "listPlugins", args: [] },
      { fn: "listPluginVersions", args: ["alpha"] },
      { fn: "listPluginVersions", args: ["beta"] },
      { fn: "parsePluginSelectorString", args: ["a@b@c"] },
      { fn: "parsePluginSelectorString", args: ["@a"] },
      { fn: "parsePluginSelectorString", args: ["01ARZ3NDEKTSV4RRFFQ69G5FAV"] },
      { fn: "parsePluginSelectorString", args: ["01arz3ndektsv4rrffq69g5fav"] },
      { fn: "parsePluginSelectorString", args: [""] },
      { fn: "isFrozenPlugin", args: [ref(1, "")] },
      { fn: "updatePluginName", args: [ref(0), "renamed"] },
      { fn: "updatePluginName", args: ["nope", "x"] },
      { fn: "updatePluginDescription", args: [ref(0), "new description"] },
      { fn: "setPluginTags", args: [ref(0), ["x", "y", "x", ""]] },
      { fn: "setPluginApName", args: [ref(0), "custom-ap"] },
      { fn: "setPluginDefaultEnvironment", args: [ref(0), "env1"] },
      { fn: "setPluginDefaultEnvironment", args: [ref(1), null] },
      { fn: "touchPluginUpdatedAt", args: [ref(2)] },
      { fn: "getPluginById", args: [ref(0)] },
      { fn: "resolveApName", args: [ref(51, "")] },
      { fn: "resolveApName", args: [{ name: "My Plugin!! v2..0" }] },
      { fn: "resolveApName", args: [{ name: "x", ap_name: "" }] },
      { fn: "deletePlugin", args: [ref(2)] },
      { fn: "deletePlugin", args: [ref(2)] },
      { fn: "listPlugins", args: [] },
    ],
  },
  {
    name: "versions and sorting",
    ops: [
      insertPlugin("p1", "v", "1.0.0"),
      insertPlugin("p2", "v", "not-semver"),
      insertPlugin("p3", "v", "2.0.0"),
      insertPlugin("p4", "v", "1.10.0"),
      insertPlugin("p5", "v", "unknown"),
      insertPlugin("p6", "v", ""),
      insertPlugin("p7", "v", "2.0.0-rc.1"),
      insertPlugin("p8", "v", "v3.0.0"),
      insertPlugin("p9", "v", "latest"),
      insertPlugin("pa", "v", "1.0"),
      insertPlugin("pb", "v", "0.9.9"),
      { fn: "getPlugin", args: ["v"] },
      { fn: "getPlugin", args: ["v@*"] },
      { fn: "getPlugin", args: ["v@^1"] },
      { fn: "getPlugin", args: ["v@>=2.0.0-0"] },
      { fn: "getPlugin", args: ["v@1.0"] },
      { fn: "getPlugin", args: ["v@unknown"] },
      { fn: "getPluginByName", args: ["v"] },
      { fn: "listPluginVersions", args: ["v"] },
      { fn: "resolvePluginSelector", args: ["v"] },
      insertPlugin("q1", "w", "1.0.0", { org_slug: "o", catalog_slug: "c" }),
      insertPlugin("q2", "w", "3.0.0", { org_slug: "o", catalog_slug: "c" }),
      { fn: "getPlugin", args: ["w"] },
      insertPlugin("q3", "w", "0.1.0"),
      { fn: "getPlugin", args: ["w"] },
      { fn: "getPlugin", args: ["w@3.0.0"] },
      { fn: "getPluginByName", args: ["w", "3.0.0"] },
    ],
  },
  {
    name: "published identity",
    ops: [
      insertPlugin("p1", "s", "1.0.0", { org_slug: "o", catalog_slug: "c" }),
      insertPlugin("p2", "s", "1.2.0", { org_slug: "o", catalog_slug: "c" }),
      insertPlugin("p3", "s", "bad", { org_slug: "o", catalog_slug: "c" }),
      insertPlugin("p4", "s", "0.5.0", { org_slug: "o2", catalog_slug: "c" }),
      insertPlugin("p5", "s", "9.0.0"),
      insertPlugin("p6", "other", "1.0.0", { org_slug: "o", catalog_slug: "c", origin_locator: "o/c/s" }),
      insertPlugin("p7", "s", "0.1.0", { org_slug: "", catalog_slug: "c" }),
      { fn: "listLatestPublishedPluginsBySlug", args: ["s"] },
      { fn: "listLatestPublishedPluginsBySlug", args: ["none"] },
      { fn: "getPluginByPublishedIdentity", args: [{ name: "s", version: "1.0.0", org: "o", catalog: "c" }] },
      { fn: "getPluginByPublishedIdentity", args: [{ name: "s", version: "9.0.0" }] },
      { fn: "getPluginByPublishedIdentity", args: [{ name: "s", version: "0.1.0", catalog: "c" }] },
      { fn: "getPluginByPublishedIdentity", args: [{ name: "s", version: "1.0.0" }] },
      { fn: "getPluginByCatalogVersion", args: ["o", "c", "1.0.0"] },
      { fn: "getPluginByCatalogVersion", args: ["o", "c", "2.0.0"] },
      { fn: "findPluginForCatalogInstall", args: [{ org: "o", catalog: "c", pluginSlug: "s", version: "1.0.0" }] },
      { fn: "findPluginForCatalogInstall", args: [{ org: "o", catalog: "c", pluginSlug: "zz", version: "1.0.0" }] },
      { fn: "__exec", args: ["UPDATE plugins SET name = 'renamed' WHERE id = 'p1'"] },
      { fn: "findPluginForCatalogInstall", args: [{ org: "o", catalog: "c", pluginSlug: "s", version: "1.0.0" }] },
      { fn: "formatPublishedPluginSelector", args: [{ org_slug: "o", catalog_slug: "c", name: "s", version: "1.0.0" }] },
      { fn: "isSamePublishedPluginIdentity", args: [{ org_slug: "o", catalog_slug: "c", name: "s" }, { org_slug: "o", catalog_slug: "c", plugin_slug: "s" }] },
      { fn: "isSamePublishedPluginIdentity", args: [{ org_slug: "o", catalog_slug: "c", name: "s" }, { org_slug: "o", catalog_slug: "x", plugin_slug: "s" }] },
      { fn: "updatePluginPublishedIdentity", args: ["p5", { org_slug: "n", catalog_slug: "k" }] },
      { fn: "updatePluginPublishedIdentity", args: ["p5", { org_slug: "n", catalog_slug: "k", version: "9.1.0" }] },
      { fn: "updatePluginPublishedIdentity", args: ["nope", { org_slug: "n", catalog_slug: "k" }] },
      { fn: "updatePluginCatalogIdentity", args: ["p4", { org_slug: "o3", catalog_slug: "c3" }] },
      { fn: "stampPluginOrigin", args: ["p5", { locator: "n/k/s" }] },
      { fn: "stampPluginOrigin", args: ["p5", { locator: "n/k/s" }] },
      { fn: "stampPluginOrigin", args: ["p5", { locator: "n/k/s", fingerprint: "sha256:1", fingerprintKind: "git_sha" }] },
      { fn: "stampPluginOrigin", args: ["p5", { locator: "n/k/s", fingerprint: "sha256:1", fingerprintKind: "git_sha" }] },
      { fn: "stampPluginOrigin", args: ["p5", { locator: "n/k/s", fingerprintKind: "" }] },
      { fn: "stampPluginOrigin", args: ["p5", { locator: "n/k/t" }] },
      { fn: "stampPluginOrigin", args: ["nope", { locator: "x" }] },
      { fn: "getPluginById", args: ["p5"] },
      { fn: "__exec", args: ["UPDATE plugins SET frozen_at = '2026-01-02' WHERE id = 'p2'"] },
      { fn: "getPluginById", args: ["p1"] },
      { fn: "bumpPluginWorkingVersion", args: ["p1", "1.2.0"] },
      { fn: "bumpPluginWorkingVersion", args: ["p1", "1.3.0"] },
      { fn: "bumpPluginWorkingVersion", args: ["nope", "1.3.0"] },
      { fn: "assertNoFrozenWorkingVersion", args: [ref(35, ""), "1.2.0"] },
      { fn: "getPluginById", args: ["p2"] },
      { fn: "isFrozenPlugin", args: [ref(40, "")] },
      { fn: "getPluginById", args: ["p1"] },
      { fn: "__exec", args: ["UPDATE plugins SET name = 's' WHERE id = 'p1'"] },
      { fn: "bumpPluginWorkingVersion", args: ["p1", "1.2.0"] },
      { fn: "getPluginById", args: ["p1"] },
      { fn: "assertNoFrozenWorkingVersion", args: [ref(45, ""), "1.2.0"] },
    ],
  },
  {
    name: "attached resources",
    ops: [
      insertPlugin("p1", "host", "1.0.0"),
      insertPlugin("p2", "other", "1.0.0"),
      insertResource("R1", "skill", "s1"),
      insertResource("R2", "rule", "r1"),
      insertResource("R3", "instruction", "i1"),
      { fn: "addResourceToPlugin", args: ["p1", "R1"] },
      { fn: "addResourceToPlugin", args: ["p1", "R2", { kind: "subset", harnesses: ["cursor", "claude", "cursor"] }] },
      { fn: "addResourceToPlugin", args: ["p1", "R2", { kind: "all" }] },
      { fn: "addResourceToPlugin", args: ["p1", "R3", { kind: "all" }] },
      { fn: "addResourceToPlugin", args: ["p2", "R1"] },
      { fn: "getPluginResources", args: ["p1"] },
      { fn: "getPluginResources", args: ["none"] },
      { fn: "getPluginResourceHarnessScope", args: ["p1", "R2"] },
      { fn: "getPluginResourceHarnessScope", args: ["p1", "R9"] },
      { fn: "setPluginResourceHarnessScope", args: ["p1", "R1", { kind: "subset", harnesses: ["codex"] }] },
      { fn: "setPluginResourceHarnessScope", args: ["p1", "R2", { kind: "all" }] },
      { fn: "getPluginResourceHarnessScope", args: ["p1", "R1"] },
      { fn: "__exec", args: ["UPDATE plugin_resources SET harness_scope = '[]' WHERE resource_id = 'R3'"] },
      { fn: "getPluginResourceHarnessScope", args: ["p1", "R3"] },
      { fn: "setPluginResourceOrder", args: ["p1", ["R3", "R1", "R2", "R9"]] },
      { fn: "getPluginResources", args: ["p1"] },
      { fn: "listPluginsAttachingResource", args: ["R1"] },
      { fn: "listPluginsAttachingResource", args: ["R9"] },
      { fn: "removeResourceFromPlugin", args: ["p1", "R1"] },
      { fn: "removeResourceFromPlugin", args: ["p1", "R1"] },
      { fn: "getPluginResources", args: ["p1"] },
      { fn: "addResourceToPlugin", args: ["p1", "R1"] },
      { fn: "getPluginResources", args: ["p1"] },
      { fn: "deletePlugin", args: ["p2"] },
      { fn: "listPluginsAttachingResource", args: ["R1"] },
    ],
  },
  {
    name: "claude config",
    ops: [
      { fn: "createPlugin", args: [{ name: "c" }] },
      { fn: "ensurePluginClaudeMarketplace", args: [ref(0, ""), "m1", { source: "github", repo: "a/b" }] },
      { fn: "getPluginById", args: [ref(0)] },
      { fn: "ensurePluginClaudeMarketplace", args: [ref(2, ""), "m1", { source: "x" }] },
      { fn: "ensurePluginClaudeMarketplace", args: [ref(2, ""), "m2", { source: "y" }] },
      { fn: "getPluginById", args: [ref(0)] },
      { fn: "syncClaudeMarketplacePluginsAfterAdd", args: [ref(5, ""), "p@m1", "^1.0.0"] },
      { fn: "getPluginById", args: [ref(0)] },
      { fn: "syncClaudeMarketplacePluginsAfterAdd", args: [ref(7, ""), "p@m1", "2.0.0"] },
      { fn: "syncClaudeMarketplacePluginsAfterAdd", args: [ref(7, ""), "q@m2", "*"] },
      { fn: "getPluginById", args: [ref(0)] },
      { fn: "syncClaudeMarketplacePluginsAfterRemove", args: [ref(10, ""), "p@m1"] },
      { fn: "getPluginById", args: [ref(0)] },
      { fn: "syncClaudeMarketplacePluginsAfterRemove", args: [ref(0, ""), "p@m1"] },
      { fn: "syncClaudeMarketplacePluginsAfterAdd", args: [ref(0, ""), "z@m", "1"] },
      { fn: "getPluginById", args: [ref(0)] },
      insertPlugin("x1", "cfg", "1.0.0", { claude_config: '{"marketplaces":{},"plugins":[]}' }),
      insertPlugin("x2", "cfg", "1.0.1", { claude_config: '{"plugins":[{"id":"a","version":"1","enabled":false,"extra":1}],"other":true}' }),
      insertPlugin("x3", "cfg", "1.0.2", { claude_config: '{"marketplaces":"ab"}' }),
      insertPlugin("x4", "cfg", "1.0.3", { claude_config: '{"plugins":{"length":0}}' }),
      insertPlugin("x5", "cfg", "1.0.4", { claude_config: '{"plugins":{"x":1}}' }),
      insertPlugin("x6", "cfg", "1.0.5", { claude_config: "[1]", needs_config: '["A","B"]', overrides: '{"versions":{"a":"1"}}' }),
      insertPlugin("x7", "cfg", "1.0.6", { claude_config: "", needs_config: "", overrides: '{"versions":null,"resources":{}}' }),
      insertPlugin("x8", "cfg", "1.0.7", { claude_config: "7", overrides: '{"resources":{"skill:a":{"x":1}}}', author_json: '{"name":"N","email":"e"}' }),
      insertPlugin("x9", "cfg", "1.0.8", { overrides: '{"versions":"x"}', dirty: 1, frozen_at: "", ap_name: "" }),
      { fn: "listPlugins", args: [] },
      { fn: "ensurePluginClaudeMarketplace", args: [ref(25, "1"), "m", { a: 1 }] },
      { fn: "syncClaudeMarketplacePluginsAfterAdd", args: [ref(25, "1"), "a", "2"] },
      { fn: "listPlugins", args: [] },
    ],
  },
  {
    name: "spec metadata and upstream",
    ops: [
      { fn: "createPlugin", args: [{ name: "m" }] },
      { fn: "setPluginSpecMetadata", args: [ref(0), { author: { name: "A", url: "https://a" }, homepage: "h", repository: "r", license: "MIT", opaqueExtensions: { "x.y": { z: [1, 2] }, "1": true } }] },
      { fn: "getPluginById", args: [ref(0)] },
      { fn: "readPluginOpaqueExtensions", args: [ref(0)] },
      { fn: "setPluginSpecMetadata", args: [ref(0), { author: {}, opaqueExtensions: {} }] },
      { fn: "getPluginById", args: [ref(0)] },
      { fn: "readPluginOpaqueExtensions", args: [ref(0)] },
      { fn: "readPluginOpaqueExtensions", args: ["nope"] },
      { fn: "__exec", args: ["UPDATE plugins SET opaque_extensions = '[1,2]'"] },
      { fn: "readPluginOpaqueExtensions", args: [ref(0)] },
      { fn: "__exec", args: ["UPDATE plugins SET opaque_extensions = 'null'"] },
      { fn: "readPluginOpaqueExtensions", args: [ref(0)] },
      { fn: "setPluginUpstream", args: [ref(0), { kind: "extends", ref: "o/c/base@^1.0.0", version_at_link: "1.0.0" }, "UP1"] },
      { fn: "getPluginById", args: [ref(0)] },
      { fn: "setPluginUpstream", args: [ref(0), { kind: "fork", ref: "local@*", version_at_link: "" }] },
      { fn: "getPluginById", args: [ref(0)] },
      { fn: "setPluginUpstream", args: [ref(0), { kind: "other", ref: "o/c/base@^1.0.0", version_at_link: "" }] },
      { fn: "getPluginById", args: [ref(0)] },
      { fn: "setPluginUpstream", args: [ref(0), { kind: "fork", ref: "", version_at_link: "" }] },
      { fn: "getPluginById", args: [ref(0)] },
      { fn: "upstreamFromRow", args: [{ upstream_kind: "extends", upstream_ref: "a@1" }] },
      { fn: "upstreamFromRow", args: [{ upstream_kind: "fork", upstream_ref: "a@1", upstream_version_at_link: "1.0.0", upstream_plugin_id: "" }] },
      { fn: "upstreamFromRow", args: [{}] },
      { fn: "buildUpstream", args: ["extends", "o/c/s", "1.2.3"] },
      { fn: "buildUpstream", args: ["fork", "o/c/s", "latest"] },
      { fn: "formatUpstreamLabel", args: [{ kind: "fork", ref: "o/c/s@^1.0.0", version_at_link: "1.0.0" }] },
      { fn: "formatUpstreamLabel", args: [{ kind: "fork", ref: "o/c/s@^1.0.0", version_at_link: "" }] },
      { fn: "exportableUpstream", args: [{ kind: "fork", ref: "o/c/s@^1.0.0", version_at_link: "1.0.0" }] },
      { fn: "exportableUpstream", args: [{ kind: "fork", ref: "s@^1.0.0", version_at_link: "1.0.0" }] },
      { fn: "exportableUpstream", args: [{ kind: "fork", ref: "o/c/s@^1.0.0", version_at_link: "1.0" }] },
      { fn: "exportableUpstream", args: [{ $undef: true }] },
      { fn: "parseUpstream", args: [{ kind: "extends", ref: "o/c/s@*", version_at_link: "2.0.0", extra: 1 }] },
      { fn: "parseUpstream", args: [{ kind: "extends", ref: "o/c/s@*", version_at_link: 2 }] },
      { fn: "parseUpstream", args: [[1]] },
      { fn: "parseUpstream", args: [null] },
      { fn: "parseUpstream", args: [{ kind: "x", ref: "o/c/s@*", version_at_link: "2.0.0" }] },
    ],
  },
  {
    name: "dependencies and merge",
    ops: [
      { fn: "createPlugin", args: [{ name: "a", tags: ["t1", "t2"], needs: ["K1"], description: "first", claude: { marketplaces: { m: { s: 1 } }, plugins: [{ id: "x", version: "1", enabled: true }] } }] },
      { fn: "createPlugin", args: [{ name: "b", tags: ["t2", "t3"], needs: ["K1", "K2"], claude: { plugins: [{ id: "x", version: "2", enabled: false }, { id: "y", version: "1", enabled: true }] } }] },
      insertResource("R1", "skill", "s"),
      insertResource("R2", "skill", "s2"),
      insertResource("R3", "rule", "r"),
      { fn: "addResourceToPlugin", args: [ref(0), "R1"] },
      { fn: "addResourceToPlugin", args: [ref(0), "R3", { kind: "subset", harnesses: ["claude"] }] },
      { fn: "addResourceToPlugin", args: [ref(1), "R2"] },
      { fn: "addResourceToPlugin", args: [ref(1), "R3", { kind: "subset", harnesses: ["cursor"] }] },
      { fn: "addDependencyToPlugin", args: [ref(0), "dep-one", "^1.0.0"] },
      { fn: "addDependencyToPlugin", args: [ref(0), "dep-two", "latest"] },
      { fn: "addDependencyToPlugin", args: [ref(1), "dep-one", "2.0.0"] },
      { fn: "addDependencyToPlugin", args: [ref(1), "dep-three", "*"] },
      { fn: "listPluginDependencies", args: [ref(0)] },
      { fn: "listPluginDependencies", args: [ref(1)] },
      { fn: "getPluginResources", args: [ref(0)] },
      { fn: "mergePluginsById", args: [[ref(0), ref(1)]] },
      { fn: "mergePluginsById", args: [[ref(1), ref(0)]] },
      { fn: "mergePluginsById", args: [[]] },
      { fn: "mergePluginsById", args: [[ref(0), "nope"]] },
      { fn: "createPluginFromSources", args: [{ name: "merged", sourcePluginIds: [ref(0), ref(1)], environmentId: "e1" }] },
      { fn: "getPluginResources", args: [ref(20)] },
      { fn: "createPluginFromSources", args: [{ name: "empty", description: "x", sourcePluginIds: [] }] },
      { fn: "createPluginFromSources", args: [{ name: "a", sourcePluginIds: [ref(0)], environmentId: "e2" }] },
      { fn: "createPluginFromSources", args: [{ name: "a", version: "1.0.0", sourcePluginIds: [ref(0)] }] },
      { fn: "createPluginFromSources", args: [{ name: "a-copy", version: "3.0.0", sourcePluginIds: [ref(0)] }] },
      { fn: "createPluginFromSources", args: [{ name: "x", sourcePluginIds: [""] }] },
      { fn: "createPluginFromSources", args: [{ name: "x", sourcePluginIds: ["nope"] }] },
      { fn: "createPluginFromSources", args: [{ name: "x", sourcePluginIds: ["nope", ref(0)] }] },
      { fn: "removeDependencyFromPlugin", args: [ref(0), "dep-one"] },
      { fn: "removeDependencyFromPlugin", args: [ref(0), "dep-one"] },
      { fn: "addDependencyToPlugin", args: [ref(0), "dep-two", "1.0.0"] },
      { fn: "listPluginDependencies", args: [ref(0)] },
      { fn: "listPluginDependencies", args: ["none"] },
    ],
  },
  {
    name: "dependency",
    ops: [
      { fn: "parseDependencyRef", args: ["dep"] },
      { fn: "parseDependencyRef", args: ["./x/y"] },
      { fn: "parseDependencyRef", args: ["../a/"] },
      { fn: "parseDependencyRef", args: ["https://github.com/o/r.git"] },
      { fn: "parseDependencyRef", args: ["git@github.com:o/r.git"] },
      { fn: "parseDependencyRef", args: ["git+ssh://h/r"] },
      { fn: "parseDependencyRef", args: ["file:///tmp/p/"] },
      { fn: "parseDependencyRef", args: ["ssh://h:22/a:b"] },
      { fn: "parseDependencyRef", args: ["o/c/n"] },
      { fn: "parseDependencyRef", args: ["o//n"] },
      { fn: "parseDependencyRef", args: ["/c/n"] },
      { fn: "parseDependencyRef", args: ["a/b"] },
      { fn: "parseDependencyRef", args: ["a/b/c/d"] },
      { fn: "parseDependencyRef", args: ["n@m"] },
      { fn: "parseDependencyRef", args: ["@m"] },
      { fn: "parseDependencyRef", args: ["n@"] },
      { fn: "parseDependencyRef", args: ["a@b@c"] },
      { fn: "parseDependencyRef", args: ["  spaced@mk  "] },
      { fn: "parseDependencyRef", args: [""] },
      { fn: "parseDependencyRef", args: ["\u00a0x\u00a0"] },
      { fn: "parseDependencyRef", args: ["http://"] },
      { fn: "parseDependencyRef", args: ["git@x"] },
      { fn: "parseDependencyRef", args: ["n@m/x"] },
      { fn: "parseDependencyRef", args: ["o/c/n@1"] },
      { fn: "parseDependencyRef", args: ["\ufeffz"] },
      { fn: "createPlugin", args: [{ name: "p", version: "1.0.0" }] },
      { fn: "createPlugin", args: [{ name: "host" }] },
      { fn: "ensureDependencyResource", args: ["dep@mk"] },
      { fn: "ensureDependencyResource", args: ["dep@mk"] },
      { fn: "ensureDependencyResource", args: ["dep@mk", { versionConstraint: "^1.0.0" }] },
      { fn: "ensureDependencyResource", args: ["./local/thing", { versionConstraint: "2", portable: "embed" }] },
      { fn: "ensureDependencyResource", args: ["org/cat/cp", { versionConstraint: "" }] },
      { fn: "ensureDependencyResource", args: ["https://github.com/o/gitdep.git"] },
      { fn: "ensureDependencyResource", args: ["  padded@mk  "] },
      { fn: "addDependency", args: [ref(25), "dep@mk"] },
      { fn: "getPluginById", args: [ref(25)] },
      { fn: "markPluginClean", args: [ref(25)] },
      { fn: "addDependency", args: [ref(25), "org/cat/cp", { versionConstraint: "~1.2", embedOnExport: true, markDirty: false }] },
      { fn: "addDependency", args: [ref(25), "./local/thing", { versionConstraint: "2" }] },
      { fn: "addDependency", args: [ref(25), "plain"] },
      { fn: "addDependency", args: [ref(25), "host@mk"] },
      { fn: "addDependency", args: [ref(25), "https://github.com/o/gitdep.git", { embedOnExport: false }] },
      { fn: "addDependency", args: ["missing", "zz"] },
      { fn: "listDependencies", args: [ref(25)] },
      { fn: "listDependencies", args: [ref(26)] },
      { fn: "addDependency", args: [ref(26), "host@mk"] },
      { fn: "addDependency", args: [ref(26), "org/cat/host"] },
      { fn: "addDependency", args: [ref(26), "../host"] },
      { fn: "listDependencies", args: [ref(26)] },
      { fn: "listDependencies", args: ["missing"] },
      { fn: "dependenciesFromResources", args: [[
        fullResource({ id: "a", type: "skill", name: "s", metadata: {} }),
        fullResource({ id: "b", type: "plugin", name: "n", metadata: {}, order: 3, harness_scope: { kind: "all" } }),
        fullResource({ id: "c", type: "plugin", name: "n", metadata: { source_kind: "git", version_constraint: "1", portable: "embed" }, origin_ref: "o" }),
        fullResource({ id: "d", type: "plugin", name: "n", metadata: { source_kind: null, version_constraint: null, portable: "reference" } }),
        fullResource({ id: "e", type: "plugin", name: "n", metadata: { source_kind: 3, version_constraint: false } }),
      ]] },
      { fn: "removeDependency", args: [ref(25), "nope"] },
      { fn: "getPluginById", args: [ref(25)] },
      { fn: "removeDependency", args: [ref(25), "cp"] },
      { fn: "removeDependency", args: [ref(25), "./local/thing"] },
      { fn: "removeDependency", args: [ref(25), "https://github.com/o/gitdep.git"] },
      { fn: "removeDependency", args: [ref(25), "dep@other"] },
      { fn: "removeDependency", args: [ref(26), "host@mk"] },
      { fn: "listDependencies", args: [ref(25)] },
      { fn: "getPluginById", args: [ref(25)] },
    ],
  },
  {
    name: "versioning",
    ops: [
      { fn: "createPlugin", args: [{ name: "v", version: "1.0.0", tags: ["t"], claude: { plugins: [{ id: "a@m", version: "1", enabled: true }] }, needs: ["N"] }] },
      insertResource("R1", "skill", "s1"),
      insertResource("R2", "rule", "r1"),
      { fn: "addResourceToPlugin", args: [ref(0), "R1"] },
      { fn: "addResourceToPlugin", args: [ref(0), "R2", { kind: "subset", harnesses: ["claude"] }] },
      { fn: "addDependencyToPlugin", args: [ref(0), "dep", "^1.0.0"] },
      { fn: "__exec", args: [`INSERT INTO plugin_excludes (plugin_id, entry, created_at) SELECT id, 'skill:x', '${T}' FROM plugins WHERE name = 'v'`] },
      { fn: "markPluginDirty", args: [ref(0)] },
      { fn: "markPluginDirty", args: [ref(0)] },
      { fn: "getPluginById", args: [ref(0)] },
      { fn: "cutPluginVersion", args: [{ pluginId: ref(0), newVersion: "1.1.0" }] },
      { fn: "cutPluginVersion", args: [{ pluginId: ref(0), newVersion: "1.1.0" }] },
      { fn: "cutPluginVersion", args: [{ pluginId: ref(0), newVersion: "bad" }] },
      { fn: "cutPluginVersion", args: [{ pluginId: ref(0), newVersion: "1.0.0" }] },
      { fn: "cutPluginVersion", args: [{ pluginId: "nope", newVersion: "2.0.0" }] },
      { fn: "listPluginVersionHistory", args: ["v"] },
      { fn: "getFrozenResolvedSet", args: [ref(15, "1.id")] },
      { fn: "removeResourceFromPlugin", args: [ref(0), "R1"] },
      { fn: "markPluginDirty", args: [ref(0)] },
      { fn: "rollbackPluginVersion", args: [{ selector: "v", toVersion: "1.0.0" }] },
      { fn: "getPluginResources", args: [ref(0)] },
      { fn: "rollbackPluginVersion", args: [{ selector: "v", toVersion: "1.1.0" }] },
      { fn: "rollbackPluginVersion", args: [{ selector: "nope", toVersion: "1.0.0" }] },
      { fn: "markPluginDirty", args: [ref(15, "1.id")] },
      { fn: "cutPluginVersion", args: [{ pluginId: ref(15, "1.id"), newVersion: "9.0.0" }] },
      { fn: "markPluginClean", args: [ref(0)] },
      { fn: "formatPluginVersionLabel", args: ["1.0.0", true] },
      { fn: "formatPluginRollbackConfirmMessage", args: [{ headVersion: "1.1.0", frozenVersion: "1.0.0", dirty: true }] },
      { fn: "formatPluginRollbackConfirmMessage", args: [{ headVersion: "1.1.0", frozenVersion: "1.0.0", dirty: false }] },
      { fn: "listPlugins", args: [] },
      { fn: "assertPluginsCleanForShare", args: [ref(29, "")] },
      { fn: "__exec", args: ["UPDATE plugins SET dirty = 1"] },
      { fn: "listPlugins", args: [] },
      { fn: "assertPluginsCleanForShare", args: [ref(32, "")] },
      { fn: "__writeConfig", args: ['// limit\n{"pluginVersionHistoryLimit": 3, }'] },
      { fn: "setPluginUpstream", args: [ref(0), { kind: "fork", ref: "o/c/v@^1.0.0", version_at_link: "1.0.0" }, "UP"] },
      { fn: "cutPluginVersion", args: [{ pluginId: ref(0), newVersion: "1.2.0" }] },
      { fn: "cutPluginVersion", args: [{ pluginId: ref(0), newVersion: "1.3.0" }] },
      { fn: "createPlugin", args: [{ name: "w" }] },
      { fn: "addDependencyToPlugin", args: [ref(38), "v", "1.1.0"] },
      { fn: "cutPluginVersion", args: [{ pluginId: ref(0), newVersion: "1.4.0" }] },
      { fn: "cutPluginVersion", args: [{ pluginId: ref(0), newVersion: "1.5.0" }] },
      { fn: "listPluginVersionHistory", args: ["v"] },
      { fn: "createPlugin", args: [{ name: "broken-x" }] },
      { fn: "markPluginDirty", args: [ref(43)] },
      { fn: "cutPluginVersion", args: [{ pluginId: ref(43), newVersion: "2.0.0" }] },
      { fn: "getFrozenResolvedSet", args: ["nope"] },
      { fn: "getPluginOrigin", args: [ref(0)] },
      { fn: "getPluginOrigin", args: ["nope"] },
      { fn: "assertAuthored", args: [ref(0), "edit"] },
      { fn: "assertSyncable", args: [ref(0)] },
      { fn: "assertSyncable", args: ["nope"] },
      { fn: "setPluginOrigin", args: [ref(0), "catalog"] },
      { fn: "rollbackPluginVersion", args: [{ selector: "v", toVersion: "1.4.0" }] },
      { fn: "assertAuthored", args: [ref(0), "publish"] },
      { fn: "assertSyncable", args: [ref(0)] },
      { fn: "setPluginOrigin", args: [ref(0), "upstream"] },
      { fn: "assertAuthored", args: [ref(0), "needs"] },
      { fn: "assertAuthored", args: ["nope", "cut"] },
      { fn: "setPluginOrigin", args: [ref(0), "authored"] },
      { fn: "__exec", args: ["UPDATE plugin_working_snapshots SET payload = json_remove(payload, '$.excludes')"] },
      { fn: "rollbackPluginVersion", args: [{ selector: "v", toVersion: "1.4.0" }] },
      { fn: "__exec", args: ["DELETE FROM plugin_working_snapshots"] },
      { fn: "cutPluginVersion", args: [{ pluginId: ref(0), newVersion: "1.6.0" }] },
      { fn: "listPluginVersionHistory", args: ["v"] },
      { fn: "listPluginVersionHistory", args: ["none"] },
      { fn: "__query", args: ["SELECT plugin_id, source_version, payload FROM plugin_working_snapshots"] },
      { fn: "__writeConfig", args: ['{"pluginVersionHistoryLimit": 2}'] },
      { fn: "cutPluginVersion", args: [{ pluginId: ref(0), newVersion: "1.7.0" }] },
      { fn: "listPluginVersionHistory", args: ["v"] },
      { fn: "markPluginClean", args: [ref(0)] },
      { fn: "rollbackPluginVersion", args: [{ selector: "v", toVersion: "1.1.0" }] },
      { fn: "__query", args: ["SELECT plugin_id, source_version, payload FROM plugin_working_snapshots"] },
      { fn: "rollbackPluginVersion", args: [{ selector: "v", toVersion: "1.6.0" }] },
      { fn: "__writeConfig", args: ['{"pluginVersionHistoryLimit": 0.5}'] },
      { fn: "cutPluginVersion", args: [{ pluginId: ref(0), newVersion: "1.8.0" }] },
      { fn: "listPluginVersionHistory", args: ["v"] },
    ],
  },
];

// Generated: random versions, selectors and names, with a fixed seed.
let seed = 0x2545f491;
const rand = (n: number) => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed % n;
};
const pick = <T>(xs: readonly T[]): T => xs[rand(xs.length)]!;
const VERSIONS = ["1.0.0", "1.2.3", "2.0.0", "2.0.0-rc.1", "0.0.1", "10.0.0", "1.0", "latest", "unknown", "", "v1.0.0", "1.0.0+build", "3.1.4-alpha.2", "bad"];
const CONSTRAINTS = ["*", "latest", "^1", "~1.2", ">=2", "<1", "1.0.0", "1.0", "x", "deadbeef0", " ^2 ", "1.x || 3.x", ">=1.0.0-0", "bad range"];
const NAMES = ["n1", "n2", "global default"];
for (let s = 0; s < 40; s += 1) {
  const ops: Op[] = [];
  const count = 2 + rand(10);
  for (let i = 0; i < count; i += 1) {
    const local = rand(3) > 0;
    ops.push(insertPlugin(`g${s}x${i}`, pick(NAMES), pick(VERSIONS), local ? {} : { org_slug: pick(["o", "p"]), catalog_slug: "c" }));
  }
  for (let i = 0; i < 12; i += 1) {
    const name = pick([...NAMES, "default", "zz"]);
    const kind = rand(6);
    if (kind === 0) ops.push({ fn: "getPlugin", args: [`${name}@${pick(CONSTRAINTS)}`] });
    else if (kind === 1) ops.push({ fn: "getPlugin", args: [name] });
    else if (kind === 2) ops.push({ fn: "resolvePluginSelector", args: [rand(2) ? name : `${name}@${pick(VERSIONS)}`] });
    else if (kind === 3) ops.push({ fn: "listPluginVersions", args: [name] });
    else if (kind === 4) ops.push({ fn: "listLatestPublishedPluginsBySlug", args: [name] });
    else ops.push({ fn: "getPluginByName", args: [name, pick([...VERSIONS, undefined as never])] });
  }
  scenarios.push({ name: `generated ${s}`, ops });
}
const CHARS = ["a", "Z", "0", "-", ".", "_", " ", "é", "İ", "ß", "--", "..", "Σ", "!", "\t", "日本", "😀", "x".repeat(70)];
const nameOps: Op[] = [];
for (let i = 0; i < 400; i += 1) {
  let source = "";
  const len = rand(8);
  for (let j = 0; j < len; j += 1) source += pick(CHARS);
  nameOps.push({ fn: pick(["slugifyApName", "slugifyAgentSkillName", "isValidApName", "isValidAgentSkillName"]), args: [source] });
  nameOps.push({ fn: pick(["isValidApName", "isValidAgentSkillName", "isCatalogUpstreamRef", "upstreamRefBase", "upstreamRange"]), args: [source.toLowerCase().replaceAll(" ", pick(["/", "@", " ", "\u00a0", "\u0085", "\ufeff"]))] });
}
scenarios.push({ name: "names", ops: nameOps });

process.env.HARNESSTAP_HOME = HOME;
const out = scenarios.map(({ name, ops }) => {
  closeDb();
  rmSync(HOME, { recursive: true, force: true });
  initializeSchema(getDb());
  getDb().exec(SETUP);
  const results: unknown[] = [];
  const calls = ops.map((op, i) => {
    setSystemTime(new Date(BASE + i * 1000));
    const args = resolve(op.args, results) as never[];
    try {
      const result = fns[op.fn]!(...args);
      results.push(result);
      return { ...op, result: plain(result) };
    } catch (error) {
      results.push(undefined);
      return { ...op, error: error instanceof Error ? error.message : String(error) };
    }
  });
  return { name, calls, dump: dump() };
});
closeDb();
rmSync(HOME, { recursive: true, force: true });
writeFileSync("rust/plugin-model-rs/tests/fixtures/plugin-model.json", JSON.stringify({ setup: SETUP, scenarios: out }, null, 1) + "\n");
console.log(`${out.length} scenarios, ${out.reduce((n, s) => n + s.calls.length, 0)} calls`);
