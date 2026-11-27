// Records what the original's models do, as fixtures for tests/fixtures.rs.
// Run from the repository root: bun rust/models-rs/tests/make-fixtures.ts
//
// Each scenario is a list of calls against a fresh database. The clock is
// pinned per call (setSystemTime), ULIDs are compared after renaming them in
// order of appearance, and arguments can refer to earlier results.
import { setSystemTime } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { closeDb, getDb } from "../../../src/db/connection.ts";
import { initializeSchema } from "../../../src/db/schema.ts";
import * as snapshot from "../../../src/models/snapshot.ts";
import * as preexisting from "../../../src/models/preexisting-path.ts";
import * as cache from "../../../src/models/package-cache-entry.ts";
import * as project from "../../../src/models/project.ts";
import * as backup from "../../../src/models/apply-removal-backup.ts";
import * as pin from "../../../src/models/plugin-pin-materialization.ts";
import * as gas from "../../../src/models/global-apply-snapshot.ts";
import * as mat from "../../../src/models/resource-materialization.ts";
import * as imp from "../../../src/models/imported-snapshot.ts";

const HOME = "/tmp/ht-models-fixture";
const BASE = Date.parse("2026-01-01T00:00:00.000Z");
type Op = { fn: string; args: unknown[] };

const fns: Record<string, (...args: never[]) => unknown> = {
  createSnapshot: snapshot.createSnapshot,
  getSnapshot: snapshot.getSnapshot,
  findSnapshotById: snapshot.findSnapshotById,
  listSnapshots: snapshot.listSnapshots,
  getLatestSnapshot: snapshot.getLatestSnapshot,
  recordPreexistingPath: preexisting.recordPreexistingPath,
  isPreexistingPath: preexisting.isPreexistingPath,
  listPreexistingPaths: preexisting.listPreexistingPaths,
  upsertPackageCacheEntry: cache.upsertPackageCacheEntry,
  findPackageCacheEntry: cache.findPackageCacheEntry,
  createProject: project.createProject,
  getProjectByLocalId: project.getProjectByLocalId,
  upsertProjectByLocalId: project.upsertProjectByLocalId,
  getProjectByOrigin: project.getProjectByOrigin,
  getProject: project.getProject,
  upsertProject: project.upsertProject,
  listProjects: project.listProjects,
  getProjectByLocalPath: project.getProjectByLocalPath,
  applyPluginToProject: project.applyPluginToProject,
  getProjectPlugins: project.getProjectPlugins,
  recordApplyRemovalBackup: backup.recordApplyRemovalBackup,
  recordTrashedApplyRemovalBackup: backup.recordTrashedApplyRemovalBackup,
  listApplyRemovalBackups: backup.listApplyRemovalBackups,
  listTrashPinnedApplyIds: backup.listTrashPinnedApplyIds,
  upsertPluginPinMaterialization: pin.upsertPluginPinMaterialization,
  matchesPluginPinMaterialization: pin.matchesPluginPinMaterialization,
  findPluginPinResourceIdByOriginRef: pin.findPluginPinResourceIdByOriginRef,
  createGlobalApplySnapshot: gas.createGlobalApplySnapshot,
  recordGlobalApplySnapshotInstall: gas.recordGlobalApplySnapshotInstall,
  getGlobalApplySnapshot: gas.getGlobalApplySnapshot,
  listGlobalApplySnapshots: gas.listGlobalApplySnapshots,
  getLatestGlobalApplySnapshotForProfile: gas.getLatestGlobalApplySnapshotForProfile,
  listGlobalApplySnapshotHeads: gas.listGlobalApplySnapshotHeads,
  renameGlobalApplySnapshotsProfile: gas.renameGlobalApplySnapshotsProfile,
  listGlobalApplySnapshotInstalls: gas.listGlobalApplySnapshotInstalls,
  recordResourceMaterialization: mat.recordResourceMaterialization,
  listMaterializationsForRoot: mat.listMaterializationsForRoot,
  listMaterializationsForRootPath: mat.listMaterializationsForRootPath,
  deleteMaterializationsForRootPaths: mat.deleteMaterializationsForRootPaths,
  listResourceMaterializations: mat.listResourceMaterializations,
  deleteResourceMaterializations: mat.deleteResourceMaterializations,
  replaceMaterializationsForPlatform: mat.replaceMaterializationsForPlatform,
  createImportedSnapshot: imp.createImportedSnapshot,
  listImportedSnapshots: imp.listImportedSnapshots,
  getLatestImportedSnapshot: imp.getLatestImportedSnapshot,
  getImportedSnapshot: imp.getImportedSnapshot,
  recordImportedSnapshotInstall: imp.recordImportedSnapshotInstall,
  removeImportedSnapshotOwnershipForFiles: imp.removeImportedSnapshotOwnershipForFiles,
  listImportedSnapshotInstalls: imp.listImportedSnapshotInstalls,
  findImportedSnapshotOwnersByFile: imp.findImportedSnapshotOwnersByFile,
  __exec: ((sql: string) => getDb().exec(sql)) as never,
  __writeFile: ((path: string, hex: string) => {
    const full = join(HOME, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, Buffer.from(hex, "hex"));
  }) as never,
};

/** `{"$ref": [i, "field"]}` is field of result i; `{"$prefix": [i, "field", n]}` its first n chars; `{"$bytes": hex}` a Buffer. */
function resolve(value: unknown, results: unknown[]): unknown {
  if (Array.isArray(value)) return value.map((v) => resolve(v, results));
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if ("$ref" in o) {
      const [i, field] = o.$ref as [number, string];
      return (results[i] as Record<string, unknown> | undefined)?.[field];
    }
    if ("$prefix" in o) {
      const [i, field, n] = o.$prefix as [number, string, number];
      return String((results[i] as Record<string, unknown>)[field]).slice(0, n);
    }
    if ("$bytes" in o) return Buffer.from(o.$bytes as string, "hex");
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, resolve(v, results)]));
  }
  return value;
}

/** A backup's `content` getter reads the trash file; a missing one becomes `{"$missing": true}`. */
function backupToPlain(b: Record<string, unknown>): unknown {
  let content: unknown;
  try {
    content = { $bytes: Buffer.from(b.content as Buffer).toString("hex") };
  } catch {
    content = { $missing: true };
  }
  return { ...Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(b)).filter(([k]) => k !== "content").map(([k, d]) => [k, d.value])), content };
}

function plain(value: unknown): unknown {
  if (Array.isArray(value) && value.length > 0 && value[0] && typeof value[0] === "object" && "in_trash" in value[0]) {
    return value.map((b) => backupToPlain(b as Record<string, unknown>));
  }
  if (value && typeof value === "object" && "in_trash" in value && "apply_id" in value) {
    return backupToPlain(value as Record<string, unknown>);
  }
  return JSON.parse(
    JSON.stringify(value ?? null, (_k, v) => {
      if (v && typeof v === "object" && v.type === "Buffer" && Array.isArray(v.data)) {
        return { $bytes: Buffer.from(v.data).toString("hex") };
      }
      if (v instanceof Uint8Array) return { $bytes: Buffer.from(v).toString("hex") };
      if (v instanceof Set) return [...v];
      return v;
    }),
  );
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
const state = { plugins: [], resources: [], platform_files: { claude: { "CLAUDE.md": "# hi\n" } }, "1": true };
const scenarios: Array<{ name: string; ops: Op[] }> = [
  {
    name: "projects",
    ops: [
      { fn: "__exec", args: [`INSERT INTO plugins (id, name, version, created_at, updated_at) VALUES ('p1', 'one', '1.0.0', '${T}', '${T}'), ('p2', 'two', '1.0.0', '${T}', '${T}')`] },
      { fn: "createProject", args: [{ git_origin: "github.com/a/b", name: "b", local_path: "/w/b" }] },
      { fn: "createProject", args: [{ git_origin: "", local_id: "loc1", name: "a", local_path: "./rel/../x/" }] },
      { fn: "getProject", args: [{ $ref: [1, "id"] }] },
      { fn: "getProject", args: ["missing"] },
      { fn: "getProjectByOrigin", args: ["github.com/a/b"] },
      { fn: "getProjectByOrigin", args: [""] },
      { fn: "getProjectByLocalId", args: ["loc1"] },
      { fn: "getProjectByLocalId", args: [""] },
      { fn: "upsertProject", args: [{ git_origin: "github.com/a/b", name: "renamed", local_path: "/w/b2" }] },
      { fn: "upsertProject", args: [{ git_origin: "github.com/c/d", name: "d", local_path: "/w/d" }] },
      { fn: "upsertProjectByLocalId", args: [{ local_id: "loc1", name: "a2", local_path: "/w/a" }] },
      { fn: "upsertProjectByLocalId", args: [{ local_id: "loc2", name: "c", local_path: "/w/c" }] },
      { fn: "listProjects", args: [] },
      { fn: "getProjectByLocalPath", args: ["/w/b2/"] },
      { fn: "getProjectByLocalPath", args: ["/w/nope"] },
      { fn: "applyPluginToProject", args: [{ project_id: { $ref: [1, "id"] }, plugin_id: "p1", platforms: ["claude", "cursor"] }] },
      { fn: "applyPluginToProject", args: [{ project_id: { $ref: [1, "id"] }, plugin_id: "p2", platforms: [] }] },
      { fn: "applyPluginToProject", args: [{ project_id: { $ref: [1, "id"] }, plugin_id: "p1", platforms: ["é\"\n"] }] },
      { fn: "getProjectPlugins", args: [{ $ref: [1, "id"] }] },
      { fn: "createProject", args: [{ git_origin: "", name: "bad", local_path: "/w/bad" }] },
    ],
  },
  {
    name: "snapshots",
    ops: [
      { fn: "createProject", args: [{ git_origin: "o", name: "p", local_path: "/p" }] },
      { fn: "createSnapshot", args: [{ project_id: { $ref: [0, "id"] }, label: "first", state }] },
      { fn: "createSnapshot", args: [{ project_id: { $ref: [0, "id"] }, label: "second", state: { plugins: [{ name: "x", n: 1.5 }], resources: [], platform_files: {} } }] },
      { fn: "getSnapshot", args: [{ $ref: [1, "id"] }] },
      { fn: "getSnapshot", args: ["nope"] },
      { fn: "findSnapshotById", args: [{ $ref: [2, "id"] }] },
      { fn: "findSnapshotById", args: [{ $prefix: [2, "id", 7] }] },
      { fn: "findSnapshotById", args: [{ $prefix: [2, "id", 24] }] },
      { fn: "findSnapshotById", args: [{ $prefix: [2, "id", 4] }, 3] },
      { fn: "listSnapshots", args: [{ $ref: [0, "id"] }] },
      { fn: "listSnapshots", args: ["other"] },
      { fn: "getLatestSnapshot", args: [{ $ref: [0, "id"] }] },
      { fn: "getLatestSnapshot", args: ["other"] },
    ],
  },
  {
    name: "preexisting paths",
    ops: [
      { fn: "recordPreexistingPath", args: [{ root_path: "/r", path: "b.md" }] },
      { fn: "recordPreexistingPath", args: [{ root_path: "/r", path: "a.md", content_hash: "h1" }] },
      { fn: "recordPreexistingPath", args: [{ root_path: "/r", path: "a.md", content_hash: "h1" }] },
      { fn: "recordPreexistingPath", args: [{ root_path: "/r", path: "a.md", content_hash: "h2" }] },
      { fn: "recordPreexistingPath", args: [{ root_path: "/r", path: "a.md", content_hash: "" }] },
      { fn: "recordPreexistingPath", args: [{ root_path: "/r", path: "a.md" }] },
      { fn: "isPreexistingPath", args: ["/r", "a.md"] },
      { fn: "isPreexistingPath", args: ["/r", "c.md"] },
      { fn: "listPreexistingPaths", args: ["/r"] },
      { fn: "listPreexistingPaths", args: ["/x"] },
      { fn: "__exec", args: ["DROP TABLE preexisting_paths"] },
      { fn: "recordPreexistingPath", args: [{ root_path: "/r", path: "z", content_hash: "h" }] },
      { fn: "isPreexistingPath", args: ["/r", "a.md"] },
      { fn: "listPreexistingPaths", args: ["/r"] },
    ],
  },
  {
    name: "package cache",
    ops: [
      { fn: "upsertPackageCacheEntry", args: [{ kind: "apm_git", origin_ref: "o/r", resolved_key: "abc", relative_path: "apm/o/r" }] },
      { fn: "upsertPackageCacheEntry", args: [{ kind: "host_plugin", origin_ref: "o/r", resolved_key: "abc", relative_path: "hp", resource_id: null, content_fingerprint: "f" }] },
      { fn: "upsertPackageCacheEntry", args: [{ kind: "apm_git", origin_ref: "o/r", resolved_key: "abc", relative_path: "apm/o/r2", content_fingerprint: "sha256:1" }] },
      { fn: "findPackageCacheEntry", args: [{ kind: "apm_git", origin_ref: "o/r", resolved_key: "abc" }] },
      { fn: "findPackageCacheEntry", args: [{ kind: "apm_git", origin_ref: "o/r", resolved_key: "zzz" }] },
    ],
  },
  {
    name: "removal backups",
    ops: [
      { fn: "recordApplyRemovalBackup", args: [{ apply_id: "A1", relative_path: "b/x.md", content: { $bytes: "68690a" }, mode: 420 }] },
      { fn: "recordApplyRemovalBackup", args: [{ apply_id: "A1", snapshot_id: "S1", relative_path: "a.bin", content: { $bytes: "00ff10" }, mode: 493 }] },
      { fn: "recordTrashedApplyRemovalBackup", args: [{ apply_id: "A2", relative_path: "dir/kept.md", mode: 420 }] },
      { fn: "recordTrashedApplyRemovalBackup", args: [{ apply_id: "A2", relative_path: "gone.md", mode: 420 }] },
      { fn: "__writeFile", args: ["trash/A2/dir/kept.md", "6b657074"] },
      { fn: "listApplyRemovalBackups", args: [{ apply_id: "A1" }] },
      { fn: "listApplyRemovalBackups", args: [{ snapshot_id: "S1", apply_id: "A2" }] },
      { fn: "listApplyRemovalBackups", args: [{ apply_id: "A2" }] },
      { fn: "listApplyRemovalBackups", args: [{}] },
      { fn: "listApplyRemovalBackups", args: [{ apply_id: "", snapshot_id: "" }] },
      { fn: "listTrashPinnedApplyIds", args: [] },
    ],
  },
  {
    name: "plugin pin materializations",
    ops: [
      { fn: "__exec", args: [`INSERT INTO resources (id, type, name, origin_ref, created_at, updated_at) VALUES ('R1', 'plugin', 'a', 'p@m', '${T}', '2026-01-02'), ('R2', 'plugin', 'b', 'p@m', '${T}', '2026-01-03'), ('R3', 'skill', 'c', 'p@m', '${T}', '2026-01-04')`] },
      { fn: "upsertPluginPinMaterialization", args: [{ scope: "global", root_path: "/h", relative_path: ".\\skills\\s\\SKILL.md", origin_ref: "p@m", resource_type: "skill", resource_name: "s" }] },
      { fn: "upsertPluginPinMaterialization", args: [{ scope: "global", root_path: "/h", relative_path: "./skills/s/SKILL.md", origin_ref: "p@m2", resource_type: "skill", resource_name: "s", plugin_pin_resource_id: "R1" }] },
      { fn: "upsertPluginPinMaterialization", args: [{ scope: "project", root_path: "/p", relative_path: "rules/r.md", origin_ref: "p@m", resource_type: "rule", resource_name: "r" }] },
      { fn: "matchesPluginPinMaterialization", args: ["/h", { type: "skill", name: "s", source: " ~/skills/s " }] },
      { fn: "matchesPluginPinMaterialization", args: ["/h", { type: "skill", name: "s", source: "skills/s/SKILL.md" }] },
      { fn: "matchesPluginPinMaterialization", args: ["/h", { type: "skill", name: "t", source: "skills/s" }] },
      { fn: "matchesPluginPinMaterialization", args: ["/p", { type: "rule", name: "r", source: "./rules/r.md" }] },
      { fn: "matchesPluginPinMaterialization", args: ["/p", { type: "rule", name: "r" }] },
      { fn: "matchesPluginPinMaterialization", args: ["/p", { type: "rule", name: "r", source: "  " }] },
      { fn: "findPluginPinResourceIdByOriginRef", args: ["p@m"] },
      { fn: "findPluginPinResourceIdByOriginRef", args: ["none"] },
    ],
  },
  {
    name: "global apply snapshots",
    ops: [
      { fn: "createGlobalApplySnapshot", args: [{ profile_name: "default", plugin_ids: ["p1", "p2"] }] },
      { fn: "createGlobalApplySnapshot", args: [{ profile_name: "default", plugin_ids: [], resolved_set: [{ name: "a", version: "1.0.0" }], state }] },
      { fn: "createGlobalApplySnapshot", args: [{ profile_name: "work", plugin_ids: ["x"], resolved_set: null, state: null }] },
      { fn: "__exec", args: ["UPDATE global_apply_snapshots SET state = 'not json' WHERE profile_name = 'work'"] },
      { fn: "getGlobalApplySnapshot", args: [{ $ref: [1, "id"] }] },
      { fn: "getGlobalApplySnapshot", args: [{ $ref: [2, "id"] }] },
      { fn: "getGlobalApplySnapshot", args: ["none"] },
      { fn: "listGlobalApplySnapshots", args: [] },
      { fn: "getLatestGlobalApplySnapshotForProfile", args: ["default"] },
      { fn: "getLatestGlobalApplySnapshotForProfile", args: ["nobody"] },
      { fn: "listGlobalApplySnapshotHeads", args: [] },
      { fn: "recordGlobalApplySnapshotInstall", args: [{ snapshot_id: { $ref: [0, "id"] }, platform_id: "claude", files: ["a", "b"] }] },
      { fn: "recordGlobalApplySnapshotInstall", args: [{ snapshot_id: { $ref: [0, "id"] }, platform_id: "cursor", files: [] }] },
      { fn: "recordGlobalApplySnapshotInstall", args: [{ snapshot_id: { $ref: [0, "id"] }, platform_id: "claude", files: ["c"] }] },
      { fn: "listGlobalApplySnapshotInstalls", args: [{ $ref: [0, "id"] }] },
      { fn: "renameGlobalApplySnapshotsProfile", args: ["default", "home"] },
      { fn: "renameGlobalApplySnapshotsProfile", args: ["default", "home"] },
      { fn: "getLatestGlobalApplySnapshotForProfile", args: ["home"] },
    ],
  },
  {
    name: "resource materializations",
    ops: [
      { fn: "__exec", args: [`INSERT INTO resources (id, type, name, created_at, updated_at) VALUES ('R1', 'skill', 'a', '${T}', '${T}'), ('R2', 'rule', 'b', '${T}', '${T}')`] },
      { fn: "recordResourceMaterialization", args: [{ resource_id: "R1", scope: "global", root_path: "/h", platform_id: "claude", path: "skills/a", action: "edit-file", ownership_key: "k1", generated_hash: "h1", managed_container: true }] },
      { fn: "recordResourceMaterialization", args: [{ resource_id: "R1", scope: "global", root_path: "/h", platform_id: "claude", path: "skills/a", action: "delete-file", ownership_key: "k1", generated_hash: "h2" }] },
      { fn: "recordResourceMaterialization", args: [{ resource_id: "R2", scope: "project", project_id: null, root_path: "/p", platform_id: "cursor", path: "rules/b.md", action: "delete-directory", ownership_key: "k2", generated_hash: "h3" }] },
      { fn: "recordResourceMaterialization", args: [{ resource_id: "R2", scope: "project", root_path: "/p", platform_id: "cursor", path: "a.md", action: "symlink", ownership_key: "k2", generated_hash: "h4" }] },
      { fn: "recordResourceMaterialization", args: [{ resource_id: "R1", scope: "project", project_id: null, root_path: "/p", platform_id: "claude", path: "a.md", action: "edit-file", ownership_key: "k4", generated_hash: "h6" }] },
      { fn: "listMaterializationsForRoot", args: ["/p"] },
      { fn: "listMaterializationsForRootPath", args: ["/h", "skills/a"] },
      { fn: "listResourceMaterializations", args: ["R2"] },
      { fn: "replaceMaterializationsForPlatform", args: [{ scope: "project", root_path: "/p", platform_id: "cursor", entries: [{ resource_id: "GONE", path: "x", action: "edit-file", ownership_key: "k", generated_hash: "h", managed_container: false }] }] },
      { fn: "listMaterializationsForRoot", args: ["/p"] },
      { fn: "replaceMaterializationsForPlatform", args: [{ scope: "project", root_path: "/p", platform_id: "cursor", entries: [{ resource_id: "GONE", path: "x", action: "edit-file", ownership_key: "k", generated_hash: "h", managed_container: false }, { resource_id: "R1", path: "skills/a2", action: "delete-file", ownership_key: "k3", generated_hash: "h5", managed_container: true }] }] },
      { fn: "listMaterializationsForRoot", args: ["/p"] },
      { fn: "deleteMaterializationsForRootPaths", args: ["/h", ["skills/a", "nope"]] },
      { fn: "deleteMaterializationsForRootPaths", args: ["/h", []] },
      { fn: "deleteResourceMaterializations", args: ["R1"] },
      { fn: "deleteResourceMaterializations", args: ["R1"] },
      { fn: "replaceMaterializationsForPlatform", args: [{ scope: "global", root_path: "/h", platform_id: "claude", entries: [] }] },
    ],
  },
  {
    name: "imported snapshots",
    ops: [
      { fn: "createImportedSnapshot", args: [{ source_kind: "claude-plugin", source_label: "local", plugin_name: "a", plugin_version: "1.0.0", resource_ids: ["R1"], metadata: { k: [1, { z: 1, a: 2 }] } }] },
      { fn: "createImportedSnapshot", args: [{ source_kind: "cursor-plugin", source_label: "x", plugin_name: "a", resource_ids: [], metadata: {} }] },
      { fn: "createImportedSnapshot", args: [{ source_kind: "agent-plugin", source_label: "y", plugin_name: "b", resource_ids: [], metadata: {} }] },
      { fn: "createImportedSnapshot", args: [{ source_kind: "skill-package", source_label: "y", plugin_name: "b", resource_ids: [], metadata: {} }] },
      { fn: "listImportedSnapshots", args: [] },
      { fn: "getLatestImportedSnapshot", args: ["a"] },
      { fn: "getLatestImportedSnapshot", args: ["zz"] },
      { fn: "getImportedSnapshot", args: [{ $ref: [0, "id"] }] },
      { fn: "recordImportedSnapshotInstall", args: [{ snapshot_id: { $ref: [0, "id"] }, platform_id: "claude", files: ["f1", "f2", "shared"] }] },
      { fn: "recordImportedSnapshotInstall", args: [{ snapshot_id: { $ref: [1, "id"] }, platform_id: "cursor", files: ["shared"] }] },
      { fn: "recordImportedSnapshotInstall", args: [{ snapshot_id: { $ref: [3, "id"] }, platform_id: "codex", files: ["shared", "g"] }] },
      { fn: "findImportedSnapshotOwnersByFile", args: ["shared"] },
      { fn: "findImportedSnapshotOwnersByFile", args: ["none"] },
      { fn: "removeImportedSnapshotOwnershipForFiles", args: [["shared", "f1"], { $ref: [3, "id"] }] },
      { fn: "listImportedSnapshotInstalls", args: [{ $ref: [0, "id"] }] },
      { fn: "listImportedSnapshotInstalls", args: [{ $ref: [1, "id"] }] },
      { fn: "listImportedSnapshotInstalls", args: [{ $ref: [3, "id"] }] },
      { fn: "removeImportedSnapshotOwnershipForFiles", args: [[]] },
      { fn: "removeImportedSnapshotOwnershipForFiles", args: [["g"], ""] },
      { fn: "findImportedSnapshotOwnersByFile", args: ["shared"] },
    ],
  },
];

process.env.HARNESSTAP_HOME = HOME;
const out = scenarios.map(({ name, ops }) => {
  closeDb();
  rmSync(HOME, { recursive: true, force: true });
  initializeSchema(getDb());
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
writeFileSync("rust/models-rs/tests/fixtures/models.json", JSON.stringify({ cwd: process.cwd(), scenarios: out }, null, 1) + "\n");
console.log(`${out.length} scenarios, ${out.reduce((n, s) => n + s.calls.length, 0)} calls`);
