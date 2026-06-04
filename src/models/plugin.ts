import { getDb } from "../db/connection.js";
import type { PluginInstall } from "../plugins/types.js";
import type { ProjectPluginInventory } from "../services/claude-plugin-inventory.js";

const DEFAULT_HARNESS = "claude-code";

export function upsertProjectPluginState(
  projectId: string,
  inventory: ProjectPluginInventory,
): void {
  const db = getDb();
  const committedJson = JSON.stringify(inventory.committed);
  const effectiveJson = JSON.stringify(inventory.effective);
  db.prepare(
    `INSERT INTO project_plugin_state (project_id, harness, scanned_at, committed, effective)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id, harness) DO UPDATE SET
       scanned_at = excluded.scanned_at,
       committed = excluded.committed,
       effective = excluded.effective`,
  ).run(projectId, DEFAULT_HARNESS, inventory.scanned_at, committedJson, effectiveJson);
}

export function getProjectPluginState(
  projectId: string,
  harness?: string,
): ProjectPluginInventory | null {
  const db = getDb();
  const h = harness ?? DEFAULT_HARNESS;
  const row = db
    .prepare(
      `SELECT scanned_at, committed, effective
       FROM project_plugin_state
       WHERE project_id = ? AND harness = ?`,
    )
    .get(projectId, h) as
    | {
        scanned_at: string;
        committed: string;
        effective: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    scanned_at: row.scanned_at,
    committed: JSON.parse(row.committed) as PluginInstall[],
    effective: JSON.parse(row.effective) as PluginInstall[],
  };
}
