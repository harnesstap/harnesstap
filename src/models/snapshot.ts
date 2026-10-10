import { getDb } from "../db/connection.js";
import { ulid } from "ulid";
import type { Snapshot, SnapshotState } from "../types.js";

interface SnapshotRow {
  id: string;
  project_id: string;
  label: string;
  state: string;
  created_at: string;
}

function rowToSnapshot(row: SnapshotRow): Snapshot {
  return {
    ...row,
    state: JSON.parse(row.state) as SnapshotState,
  };
}

export function createSnapshot(input: {
  project_id: string;
  label: string;
  state: SnapshotState;
}): Snapshot {
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();

  db.prepare(
    `INSERT INTO snapshots (id, project_id, label, state, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.project_id, input.label, JSON.stringify(input.state), now);

  return { id, ...input, created_at: now };
}

export function getSnapshot(id: string): Snapshot | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM snapshots WHERE id = ?").get(id) as
    | SnapshotRow
    | undefined;
  return row ? rowToSnapshot(row) : undefined;
}

/** Exact id, or a unique prefix of at least `minPrefix` characters. */
export function findSnapshotById(id: string, minPrefix = 8): Snapshot | undefined {
  const exact = getSnapshot(id);
  if (exact) {
    return exact;
  }
  if (id.length < minPrefix) {
    return undefined;
  }
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM snapshots WHERE id LIKE ?")
    .all(`${id}%`) as SnapshotRow[];
  if (rows.length !== 1) {
    return undefined;
  }
  const row = rows[0];
  return row ? rowToSnapshot(row) : undefined;
}

export function listSnapshots(projectId: string): Snapshot[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM snapshots WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as SnapshotRow[];
  return rows.map(rowToSnapshot);
}

export function getLatestSnapshot(projectId: string): Snapshot | undefined {
  const snapshots = listSnapshots(projectId);
  return snapshots[0];
}
