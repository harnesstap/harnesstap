/**
 * Project identity: which `projects` row a folder belongs to.
 *
 * Snapshots, drift, history and revert live in the local database and are
 * keyed by `projects.id`. Nothing is pushed anywhere, so a git remote is only
 * a stable name for the project, not a requirement.
 *
 * Scheme:
 * - Folder with a git `origin`: the project is keyed by the normalized origin
 *   URL (`projects.git_origin`, see normalizeGitUrl). Moving or re-cloning the
 *   folder keeps the same project.
 * - Folder without an origin (not a git repo, or a repo with no `origin`):
 *   the project is keyed by `projects.local_id = "path:" + normalizeProjectPath(root)`.
 *
 * normalizeProjectPath:
 * 1. Resolve to an absolute path, then `realpath` it so symlinks (for example
 *    macOS /var -> /private/var) map to one folder. A folder that does not
 *    exist keeps its resolved absolute path.
 * 2. Windows: backslashes become "/" and the path is lowercased (NTFS is case
 *    insensitive). macOS: lowercased too (APFS and HFS+ are case insensitive by
 *    default; two folders that differ only in case on a case-sensitive volume
 *    would share an ID). Linux and other platforms keep the case as is.
 * 3. Trailing separators are removed, except for a filesystem root.
 *
 * When an origin appears for a folder that already has a path-keyed project,
 * findProjectForRoot / ensureProjectForRoot move that project's rows to the
 * origin-keyed project (migratePathProjectToOrigin). The database is copied to
 * `<HARNESSTAP_HOME>/backups/` first and the move runs in one transaction.
 */
import { mkdirSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ulid } from "ulid";
import { getDb, getHarnesstapDir } from "../db/connection.js";
import type { SqliteDatabase } from "../db/types.js";
import {
  getProjectByLocalId,
  getProjectByOrigin,
  upsertProject,
  upsertProjectByLocalId,
} from "../models/project.js";
import type { Project } from "../types.js";
import { getGitOrigin, normalizeGitUrl, projectNameFromUrl } from "./git.js";

export const PATH_PROJECT_ID_PREFIX = "path:";

export type ProjectIdentity =
  | {
    kind: "origin";
    root: string;
    /** Normalized origin URL (projects.git_origin). */
    gitOrigin: string;
    gitOriginRaw: string;
    /** The path-based ID this folder would have without an origin. */
    localId: string;
    name: string;
  }
  | {
    kind: "path";
    root: string;
    localId: string;
    name: string;
  };

function realOrResolved(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function isCaseInsensitivePlatform(platform: NodeJS.Platform): boolean {
  return platform === "win32" || platform === "darwin";
}

function stripTrailingSeparators(path: string): string {
  let out = path;
  while (out.length > 1 && out.endsWith("/") && !/^[a-z]:\/$/i.test(out)) {
    out = out.slice(0, -1);
  }
  return out;
}

/** Normalized absolute folder path used for path-based project IDs (scheme above). */
export function normalizeProjectPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  let out = realOrResolved(path);
  if (platform === "win32") {
    out = out.replace(/\\/g, "/");
  }
  if (isCaseInsensitivePlatform(platform)) {
    out = out.toLowerCase();
  }
  return stripTrailingSeparators(out);
}

/** `projects.local_id` for a folder without a git origin. */
export function pathProjectId(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return `${PATH_PROJECT_ID_PREFIX}${normalizeProjectPath(path, platform)}`;
}

export function resolveProjectIdentity(projectRoot: string): ProjectIdentity {
  const root = resolve(projectRoot);
  const localId = pathProjectId(root);
  const gitOriginRaw = getGitOrigin(root);
  if (gitOriginRaw) {
    return {
      kind: "origin",
      root,
      gitOrigin: normalizeGitUrl(gitOriginRaw),
      gitOriginRaw,
      localId,
      name: projectNameFromUrl(gitOriginRaw),
    };
  }
  return { kind: "path", root, localId, name: basename(realOrResolved(root)) || root };
}

/** Existing project for a folder, or undefined. Adopts path-keyed history once an origin exists. */
export function findProjectForRoot(
  projectRoot: string,
  identity: ProjectIdentity = resolveProjectIdentity(projectRoot),
): Project | undefined {
  if (identity.kind === "path") {
    return getProjectByLocalId(identity.localId);
  }
  migratePathProjectToOrigin(identity);
  // If the move could not run (for example the backup failed), keep serving
  // the path-keyed history rather than hiding it.
  return getProjectByOrigin(identity.gitOrigin) ?? getProjectByLocalId(identity.localId);
}

/** Project for a folder, created when missing. Adopts path-keyed history once an origin exists. */
export function ensureProjectForRoot(
  projectRoot: string,
  identity: ProjectIdentity = resolveProjectIdentity(projectRoot),
): Project {
  if (identity.kind === "path") {
    return upsertProjectByLocalId({
      local_id: identity.localId,
      name: identity.name,
      local_path: identity.root,
    });
  }
  const migration = migratePathProjectToOrigin(identity);
  if (migration.status === "failed") {
    const pathProject = getProjectByLocalId(identity.localId);
    if (pathProject) {
      return pathProject;
    }
  }
  return upsertProject({
    git_origin: identity.gitOrigin,
    name: identity.name,
    local_path: identity.root,
  });
}

export type ProjectOriginMigration =
  | { status: "none" }
  | {
    status: "migrated";
    projectId: string;
    /** True when an origin-keyed project already existed and the rows were merged into it. */
    merged: boolean;
    movedSnapshots: number;
    backupPath: string;
  }
  | { status: "failed"; error: string; backupPath?: string };

/** Copy the database (consistent snapshot, WAL included) into `<HARNESSTAP_HOME>/backups/`. */
export function backupDatabase(reason: string, db: SqliteDatabase = getDb()): string {
  const dir = join(getHarnesstapDir(), "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const file = join(dir, `harnesstap-${stamp}-${ulid()}-${reason}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

function pendingPathProjectId(db: SqliteDatabase, localId: string): string | undefined {
  const row = db
    .prepare("SELECT id FROM projects WHERE local_id = ? AND git_origin = ''")
    .get(localId) as { id: string } | undefined;
  return row?.id;
}

/** Rows that point at a project: every table with a `project_id` column. */
function projectChildTables(db: SqliteDatabase): Array<{ name: string; pk: string[] }> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'projects'")
    .all() as Array<{ name: string }>;
  const out: Array<{ name: string; pk: string[] }> = [];
  for (const { name } of tables) {
    const columns = db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{
      name: string;
      pk: number;
    }>;
    if (!columns.some((column) => column.name === "project_id")) {
      continue;
    }
    const pk = columns
      .filter((column) => column.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((column) => column.name);
    out.push({ name, pk });
  }
  return out;
}

/** Tables whose conflicting row is settled by "most recent wins". */
const RECENCY_COLUMN: Record<string, string> = {
  project_plugins: "applied_at",
  project_layers: "applied_at",
  project_harnesses: "updated_at",
};

/**
 * Move every row of `fromId` onto `toId`. Snapshots (and any row keyed by its
 * own id) move as is, so history keeps its order (created_at). Where both
 * projects hold the same keyed row (for example the same plugin applied), the
 * more recent one is kept; otherwise the origin project's row is kept.
 */
function mergeProjectRows(db: SqliteDatabase, fromId: string, toId: string): number {
  let movedSnapshots = 0;
  for (const table of projectChildTables(db)) {
    const quoted = `"${table.name}"`;
    const keyColumns = table.pk.filter((column) => column !== "project_id");
    const recency = RECENCY_COLUMN[table.name];
    if (recency && table.pk.includes("project_id")) {
      const sameKey = keyColumns.map((column) => `o."${column}" = p."${column}"`).join(" AND ");
      const match = sameKey ? ` AND ${sameKey}` : "";
      db.prepare(
        `DELETE FROM ${quoted} AS o WHERE o.project_id = ? AND EXISTS (
           SELECT 1 FROM ${quoted} AS p
           WHERE p.project_id = ?${match} AND p."${recency}" > o."${recency}")`,
      ).run(toId, fromId);
    }
    const result = db
      .prepare(`UPDATE OR IGNORE ${quoted} SET project_id = ? WHERE project_id = ?`)
      .run(toId, fromId);
    if (table.name === "snapshots") {
      movedSnapshots = result.changes;
    }
  }
  return movedSnapshots;
}

/**
 * Re-key a folder's path-based project to its git origin. Safe to call on
 * every lookup: it is a single indexed read when there is nothing to move.
 *
 * Idempotent and safe across processes: the transaction takes the write lock
 * first, then re-checks that the path-keyed row still exists (another process
 * may have moved it), so a second run is a no-op and never duplicates rows.
 */
export function migratePathProjectToOrigin(
  identity: Extract<ProjectIdentity, { kind: "origin" }>,
  db: SqliteDatabase = getDb(),
): ProjectOriginMigration {
  if (!pendingPathProjectId(db, identity.localId)) {
    return { status: "none" };
  }
  let backupPath: string;
  try {
    backupPath = backupDatabase("before-project-origin", db);
  } catch (error) {
    // No backup, no move: the path-keyed history stays where it is.
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
  try {
    const run = db.transaction((): ProjectOriginMigration => {
      // Write first so a concurrent migrator waits on the lock, then re-check.
      db.prepare("UPDATE projects SET local_id = local_id WHERE local_id = ?").run(identity.localId);
      const fromId = pendingPathProjectId(db, identity.localId);
      if (!fromId) {
        return { status: "none" };
      }
      const target = db
        .prepare("SELECT id FROM projects WHERE git_origin = ?")
        .get(identity.gitOrigin) as { id: string } | undefined;
      if (!target) {
        db.prepare(
          "UPDATE projects SET git_origin = ?, local_id = '', name = ?, local_path = ? WHERE id = ?",
        ).run(identity.gitOrigin, identity.name, identity.root, fromId);
        const counted = db
          .prepare("SELECT COUNT(*) AS n FROM snapshots WHERE project_id = ?")
          .get(fromId) as { n: number } | undefined;
        return {
          status: "migrated",
          projectId: fromId,
          merged: false,
          movedSnapshots: counted?.n ?? 0,
          backupPath,
        };
      }
      const movedSnapshots = mergeProjectRows(db, fromId, target.id);
      const leftover = db
        .prepare("SELECT COUNT(*) AS n FROM snapshots WHERE project_id = ?")
        .get(fromId) as { n: number } | undefined;
      if ((leftover?.n ?? 0) > 0) {
        // Snapshots never collide (own ULID keys); refuse rather than drop history.
        throw new Error("Snapshots were left on the folder project; nothing was changed.");
      }
      // History now belongs to the origin project. What remains on the folder
      // row is only config already held by the origin project (older duplicates).
      db.prepare("DELETE FROM projects WHERE id = ?").run(fromId);
      db.prepare("UPDATE projects SET local_path = ? WHERE id = ?").run(identity.root, target.id);
      return { status: "migrated", projectId: target.id, merged: true, movedSnapshots, backupPath };
    });
    return run();
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      backupPath,
    };
  }
}
