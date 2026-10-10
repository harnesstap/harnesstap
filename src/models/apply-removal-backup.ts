import { ulid } from "ulid";
import { getDb } from "../db/connection.js";

interface ApplyRemovalBackupRow {
  id: string;
  apply_id: string;
  snapshot_id: string | null;
  relative_path: string;
  content: Buffer | Uint8Array | string;
  mode: number;
  created_at: string;
}

export interface ApplyRemovalBackup {
  id: string;
  apply_id: string;
  snapshot_id: string | null;
  relative_path: string;
  content: Buffer;
  mode: number;
  created_at: string;
}

function toBuffer(value: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === "string") {
    return Buffer.from(value, "utf-8");
  }
  return Buffer.from(value);
}

function rowToBackup(row: ApplyRemovalBackupRow): ApplyRemovalBackup {
  return {
    id: row.id,
    apply_id: row.apply_id,
    snapshot_id: row.snapshot_id,
    relative_path: row.relative_path,
    content: toBuffer(row.content),
    mode: row.mode,
    created_at: row.created_at,
  };
}

export function recordApplyRemovalBackup(input: {
  apply_id: string;
  snapshot_id?: string | null;
  relative_path: string;
  content: Buffer;
  mode: number;
}): ApplyRemovalBackup {
  const db = getDb();
  const row: ApplyRemovalBackup = {
    id: ulid(),
    apply_id: input.apply_id,
    snapshot_id: input.snapshot_id ?? null,
    relative_path: input.relative_path,
    content: input.content,
    mode: input.mode,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO apply_removal_backups (
      id, apply_id, snapshot_id, relative_path, content, mode, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.apply_id,
    row.snapshot_id,
    row.relative_path,
    row.content,
    row.mode,
    row.created_at,
  );
  return row;
}

export function listApplyRemovalBackups(input: {
  apply_id?: string;
  snapshot_id?: string;
}): ApplyRemovalBackup[] {
  const db = getDb();
  if (input.snapshot_id) {
    const rows = db
      .prepare(
        `SELECT * FROM apply_removal_backups
         WHERE snapshot_id = ?
         ORDER BY relative_path ASC`,
      )
      .all(input.snapshot_id) as ApplyRemovalBackupRow[];
    return rows.map(rowToBackup);
  }
  if (input.apply_id) {
    const rows = db
      .prepare(
        `SELECT * FROM apply_removal_backups
         WHERE apply_id = ?
         ORDER BY relative_path ASC`,
      )
      .all(input.apply_id) as ApplyRemovalBackupRow[];
    return rows.map(rowToBackup);
  }
  return [];
}
