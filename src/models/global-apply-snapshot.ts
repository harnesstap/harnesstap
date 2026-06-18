import { ulid } from "ulid";
import { getDb } from "../db/connection.js";
import type { GlobalApplySnapshot, GlobalApplySnapshotInstall } from "../types.js";

interface GlobalApplySnapshotRow {
  id: string;
  profile_name: string;
  layer_ids: string;
  created_at: string;
}

interface GlobalApplySnapshotInstallRow {
  snapshot_id: string;
  platform_id: string;
  files: string;
  installed_at: string;
}

function rowToGlobalApplySnapshot(row: GlobalApplySnapshotRow): GlobalApplySnapshot {
  return {
    ...row,
    layer_ids: JSON.parse(row.layer_ids) as string[],
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
  layer_ids: string[];
}): GlobalApplySnapshot {
  const db = getDb();
  const snapshot: GlobalApplySnapshot = {
    id: ulid(),
    profile_name: input.profile_name,
    layer_ids: input.layer_ids,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO global_apply_snapshots (id, profile_name, layer_ids, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(
    snapshot.id,
    snapshot.profile_name,
    JSON.stringify(snapshot.layer_ids),
    snapshot.created_at,
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
