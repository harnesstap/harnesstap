import { ulid } from "ulid";
import { getDb } from "../db/connection.js";
import { computationSlot } from "../services/status-computation.js";
import type {
  GlobalApplySnapshot,
  GlobalApplySnapshotInstall,
  SnapshotState,
} from "../types.js";

interface GlobalApplySnapshotRow {
  id: string;
  profile_name: string;
  plugin_ids: string;
  resolved_set: string;
  created_at: string;
  state?: string;
}

interface GlobalApplySnapshotInstallRow {
  snapshot_id: string;
  platform_id: string;
  files: string;
  installed_at: string;
}

function parseState(raw: string | undefined): SnapshotState | undefined {
  if (!raw || raw === "{}") {
    return undefined;
  }
  try {
    return JSON.parse(raw) as SnapshotState;
  } catch {
    return undefined;
  }
}

function rowToGlobalApplySnapshot(row: GlobalApplySnapshotRow): GlobalApplySnapshot {
  const state = parseState(row.state);
  return {
    id: row.id,
    profile_name: row.profile_name,
    plugin_ids: JSON.parse(row.plugin_ids) as string[],
    resolved_set: JSON.parse(row.resolved_set ?? "[]") as Array<{
      name: string;
      version: string;
    }>,
    created_at: row.created_at,
    ...(state ? { state } : {}),
  };
}

function rowToGlobalApplySnapshotInstall(
  row: GlobalApplySnapshotInstallRow,
): GlobalApplySnapshotInstall {
  return {
    ...row,
    files: JSON.parse(row.files) as string[],
  };
}

export function createGlobalApplySnapshot(input: {
  profile_name: string;
  plugin_ids: string[];
  resolved_set?: Array<{ name: string; version: string }>;
  state?: SnapshotState;
}): GlobalApplySnapshot {
  const db = getDb();
  const snapshot: GlobalApplySnapshot = {
    id: ulid(),
    profile_name: input.profile_name,
    plugin_ids: input.plugin_ids,
    resolved_set: input.resolved_set ?? [],
    created_at: new Date().toISOString(),
    ...(input.state ? { state: input.state } : {}),
  };
  db.prepare(
    `INSERT INTO global_apply_snapshots (id, profile_name, plugin_ids, resolved_set, created_at, state)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    snapshot.id,
    snapshot.profile_name,
    JSON.stringify(snapshot.plugin_ids),
    JSON.stringify(snapshot.resolved_set),
    snapshot.created_at,
    JSON.stringify(input.state ?? {}),
  );
  return snapshot;
}

export function recordGlobalApplySnapshotInstall(input: {
  snapshot_id: string;
  platform_id: string;
  files: string[];
}): GlobalApplySnapshotInstall {
  const db = getDb();
  const install: GlobalApplySnapshotInstall = {
    ...input,
    installed_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO global_apply_snapshot_installs (
      snapshot_id,
      platform_id,
      files,
      installed_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(snapshot_id, platform_id) DO UPDATE SET
      files = excluded.files,
      installed_at = excluded.installed_at`,
  ).run(
    install.snapshot_id,
    install.platform_id,
    JSON.stringify(install.files),
    install.installed_at,
  );
  return install;
}

export function getGlobalApplySnapshot(snapshotId: string): GlobalApplySnapshot | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM global_apply_snapshots WHERE id = ?")
    .get(snapshotId) as GlobalApplySnapshotRow | undefined;
  return row ? rowToGlobalApplySnapshot(row) : undefined;
}

export function listGlobalApplySnapshots(): GlobalApplySnapshot[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM global_apply_snapshots ORDER BY created_at DESC, id DESC")
    .all() as GlobalApplySnapshotRow[];
  return rows.map(rowToGlobalApplySnapshot);
}

export function getLatestGlobalApplySnapshotForProfile(
  profileName: string,
): GlobalApplySnapshot | undefined {
  return computationSlot(`latest-global-apply-snapshot:${profileName}`, () => {
    const head = getDb()
      .prepare(
        `SELECT id FROM global_apply_snapshots WHERE profile_name = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(profileName) as { id: string } | undefined;
    if (!head) return undefined;
    const parsed = parsedSnapshotById.get(head.id);
    if (parsed) {
      parsedSnapshotById.delete(head.id);
      parsedSnapshotById.set(head.id, parsed);
      return { ...parsed, profile_name: profileName };
    }
    const snapshot = getGlobalApplySnapshot(head.id);
    if (!snapshot) return undefined;
    parsedSnapshotById.set(head.id, snapshot);
    if (parsedSnapshotById.size > PARSED_SNAPSHOT_CACHE_MAX) {
      const oldest = parsedSnapshotById.keys().next().value;
      if (oldest !== undefined) parsedSnapshotById.delete(oldest);
    }
    return { ...snapshot };
  });
}

// Apply snapshots are written once and only renamed later, so a parsed row
// is reused by id. The profile name comes from the current row.
const PARSED_SNAPSHOT_CACHE_MAX = 8;
const parsedSnapshotById = new Map<string, GlobalApplySnapshot>();

export interface GlobalApplySnapshotHead {
  id: string;
  profile_name: string;
}

/**
 * Snapshot ids and profile names, newest first, without parsing each
 * snapshot's stored state. Same order as `listGlobalApplySnapshots`.
 */
export function listGlobalApplySnapshotHeads(): GlobalApplySnapshotHead[] {
  return computationSlot("global-apply-snapshot-heads", () =>
    getDb()
      .prepare(
        `SELECT id, profile_name FROM global_apply_snapshots
         ORDER BY created_at DESC, id DESC`,
      )
      .all() as GlobalApplySnapshotHead[]);
}

export function renameGlobalApplySnapshotsProfile(
  oldName: string,
  newName: string,
): number {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE global_apply_snapshots SET profile_name = ? WHERE profile_name = ?`,
    )
    .run(newName, oldName);
  return result.changes;
}

export function listGlobalApplySnapshotInstalls(
  snapshotId: string,
): GlobalApplySnapshotInstall[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT snapshot_id, platform_id, files, installed_at
       FROM global_apply_snapshot_installs
       WHERE snapshot_id = ?
       ORDER BY installed_at DESC, platform_id ASC`,
    )
    .all(snapshotId) as GlobalApplySnapshotInstallRow[];
  return rows.map(rowToGlobalApplySnapshotInstall);
}
