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
