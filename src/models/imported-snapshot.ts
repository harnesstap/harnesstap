import { ulid } from "ulid";
import { getDb } from "../db/connection.js";
import type {
  ImportedSnapshot,
  ImportedSnapshotInstall,
  ImportedSnapshotMetadata,
} from "../types.js";

interface ImportedSnapshotRow {
  id: string;
  source_kind: ImportedSnapshot["source_kind"];
  source_label: string;
  plugin_name: string;
  plugin_version: string | null;
  resource_ids: string;
  metadata: string;
  created_at: string;
}

interface ImportedSnapshotInstallRow {
  snapshot_id: string;
  platform_id: string;
  files: string;
  installed_at: string;
}

function rowToImportedSnapshot(row: ImportedSnapshotRow): ImportedSnapshot {
  return {
    ...row,
    plugin_version: row.plugin_version ?? undefined,
    resource_ids: JSON.parse(row.resource_ids) as string[],
    metadata: JSON.parse(row.metadata) as ImportedSnapshotMetadata,
  };
}

function rowToImportedSnapshotInstall(
  row: ImportedSnapshotInstallRow,
): ImportedSnapshotInstall {
  return {
    ...row,
    files: JSON.parse(row.files) as string[],
  };
}

export function createImportedSnapshot(input: {
  source_kind: ImportedSnapshot["source_kind"];
  source_label: string;
  plugin_name: string;
  plugin_version?: string;
  resource_ids: string[];
  metadata: ImportedSnapshotMetadata;
}): ImportedSnapshot {
  const db = getDb();
  const snapshot: ImportedSnapshot = {
    id: ulid(),
    source_kind: input.source_kind,
    source_label: input.source_label,
    plugin_name: input.plugin_name,
    plugin_version: input.plugin_version,
    resource_ids: input.resource_ids,
    metadata: input.metadata,
    created_at: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO imported_snapshots (
      id,
      source_kind,
      source_label,
      plugin_name,
      plugin_version,
      resource_ids,
      metadata,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    snapshot.id,
    snapshot.source_kind,
    snapshot.source_label,
    snapshot.plugin_name,
    snapshot.plugin_version ?? null,
    JSON.stringify(snapshot.resource_ids),
    JSON.stringify(snapshot.metadata),
    snapshot.created_at,
  );

  return snapshot;
}

export function listImportedSnapshots(): ImportedSnapshot[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM imported_snapshots ORDER BY created_at DESC, id DESC",
    )
    .all() as ImportedSnapshotRow[];
  return rows.map(rowToImportedSnapshot);
}

export function recordImportedSnapshotInstall(input: {
  snapshot_id: string;
  platform_id: string;
  files: string[];
}): ImportedSnapshotInstall {
  const db = getDb();
  const install: ImportedSnapshotInstall = {
    ...input,
    installed_at: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO imported_snapshot_installs (
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

export function listImportedSnapshotInstalls(
  snapshotId: string,
): ImportedSnapshotInstall[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT snapshot_id, platform_id, files, installed_at
       FROM imported_snapshot_installs
       WHERE snapshot_id = ?
       ORDER BY installed_at DESC, platform_id ASC`,
    )
    .all(snapshotId) as ImportedSnapshotInstallRow[];
  return rows.map(rowToImportedSnapshotInstall);
}
