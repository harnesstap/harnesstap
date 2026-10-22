import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";
import { getDb, getHarnesstapDir } from "../db/connection.js";

interface ApplyRemovalBackupRow {
  id: string;
  apply_id: string;
  snapshot_id: string | null;
  relative_path: string;
  content: Buffer | Uint8Array | string;
  mode: number;
  in_trash?: number;
  created_at: string;
}

export interface ApplyRemovalBackup {
  id: string;
  apply_id: string;
  snapshot_id: string | null;
  relative_path: string;
  /**
   * The removed bytes. A backup kept in the trash holds no copy in the
   * database: the bytes are read from the trash file when asked for.
   */
  readonly content: Buffer;
  mode: number;
  /** True when the trash file under the apply folder is the only copy. */
  in_trash: boolean;
  created_at: string;
}

/** Where an apply's trash folder keeps the removed file at `relativePath`. */
export function removalBackupTrashFile(applyId: string, relativePath: string): string {
  return join(getHarnesstapDir(), "trash", applyId, ...relativePath.split("/"));
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
  const inTrash = row.in_trash === 1;
  const stored = row.content;
  return {
    id: row.id,
    apply_id: row.apply_id,
    snapshot_id: row.snapshot_id,
    relative_path: row.relative_path,
    get content(): Buffer {
      return inTrash
        ? readFileSync(removalBackupTrashFile(row.apply_id, row.relative_path))
        : toBuffer(stored);
    },
    mode: row.mode,
    in_trash: inTrash,
    created_at: row.created_at,
  };
}

/** Records one undo backup, with the bytes in the row. */
export function recordApplyRemovalBackup(input: {
  apply_id: string;
  snapshot_id?: string | null;
  relative_path: string;
  content: Buffer;
  mode: number;
}): ApplyRemovalBackup {
  return insertBackup({ ...input, in_trash: false });
}

/**
 * Records an undo backup whose bytes are already in the apply's trash folder
 * (the file was moved there), so the row carries no copy.
 */
export function recordTrashedApplyRemovalBackup(input: {
  apply_id: string;
  snapshot_id?: string | null;
  relative_path: string;
  mode: number;
}): ApplyRemovalBackup {
  return insertBackup({ ...input, content: Buffer.alloc(0), in_trash: true });
}

function insertBackup(input: {
  apply_id: string;
  snapshot_id?: string | null;
  relative_path: string;
  content: Buffer;
  mode: number;
  in_trash: boolean;
}): ApplyRemovalBackup {
  const db = getDb();
  const row: ApplyRemovalBackupRow = {
    id: ulid(),
    apply_id: input.apply_id,
    snapshot_id: input.snapshot_id ?? null,
    relative_path: input.relative_path,
    content: input.content,
    mode: input.mode,
    in_trash: input.in_trash ? 1 : 0,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO apply_removal_backups (
      id, apply_id, snapshot_id, relative_path, content, mode, in_trash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.apply_id,
    row.snapshot_id,
    row.relative_path,
    row.content,
    row.mode,
    row.in_trash,
    row.created_at,
  );
  return rowToBackup(row);
}

/**
 * Backups kept in the trash whose file is gone cannot be restored. Rows are
 * returned only when their bytes are still available.
 */
function restorable(rows: ApplyRemovalBackupRow[]): ApplyRemovalBackup[] {
  return rows
    .filter(
      (row) =>
        row.in_trash !== 1
        || existsSync(removalBackupTrashFile(row.apply_id, row.relative_path)),
    )
    .map(rowToBackup);
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
    return restorable(rows);
  }
  if (input.apply_id) {
    const rows = db
      .prepare(
        `SELECT * FROM apply_removal_backups
         WHERE apply_id = ?
         ORDER BY relative_path ASC`,
      )
      .all(input.apply_id) as ApplyRemovalBackupRow[];
    return restorable(rows);
  }
  return [];
}

/** Apply ids whose trash folder holds the only copy of some backup. */
export function listTrashPinnedApplyIds(): Set<string> {
  const rows = getDb()
    .prepare("SELECT DISTINCT apply_id FROM apply_removal_backups WHERE in_trash = 1")
    .all() as Array<{ apply_id: string }>;
  return new Set(rows.map((row) => row.apply_id));
}
