import { getProjectByLocalPath } from "../../../models/project.js";
import { listSnapshots } from "../../../models/snapshot.js";
import { getDb } from "../../../db/connection.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

function listAllSnapshotCandidates(): CompletionCandidate[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, label, created_at FROM snapshots ORDER BY created_at DESC")
    .all() as Array<{ id: string; label: string; created_at: string }>;

  return rows.map((row) => ({
    value: row.id,
    description: row.label || row.created_at,
  }));
}

export function completeSnapshotIds(ctx: CompletionContext): CompletionCandidate[] {
  if (!ctx.localDataAvailable) {
    return [];
  }

  try {
    const project = getProjectByLocalPath(process.cwd());
    const candidates = project
      ? listSnapshots(project.id).map((snapshot) => ({
          value: snapshot.id,
          description: snapshot.label || snapshot.created_at,
        }))
      : listAllSnapshotCandidates();

    return filterByPrefix(candidates, ctx.prefix);
  } catch {
    return [];
  }
}
