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

export interface PresetPluginRow {
  preset_id: string;
  ref: string;
  version_constraint: string;
  order: number;
  embed_on_export: boolean;
}

export function addPluginToPreset(
  presetId: string,
  ref: string,
  versionConstraint: string,
  opts?: { embedOnExport?: boolean; order?: number },
): void {
  const db = getDb();
  const embed = (opts?.embedOnExport ?? false) ? 1 : 0;
  let order = opts?.order;
  if (order === undefined) {
    const maxOrder = db
      .prepare(
        'SELECT COALESCE(MAX("order"), -1) as max_order FROM preset_plugins WHERE preset_id = ?',
      )
      .get(presetId) as { max_order: number };
    order = maxOrder.max_order + 1;
  }

  db.prepare(
    `INSERT INTO preset_plugins (preset_id, ref, version_constraint, "order", embed_on_export)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(preset_id, ref) DO UPDATE SET
       version_constraint = excluded.version_constraint,
       "order" = excluded."order",
       embed_on_export = excluded.embed_on_export`,
  ).run(presetId, ref, versionConstraint, order, embed);
}

export function removePluginFromPreset(presetId: string, ref: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM preset_plugins WHERE preset_id = ? AND ref = ?`).run(
    presetId,
    ref,
  );
}

export function listPresetPlugins(presetId: string): PresetPluginRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT preset_id, ref, version_constraint, "order", embed_on_export
       FROM preset_plugins
       WHERE preset_id = ?
       ORDER BY "order" ASC`,
    )
    .all(presetId) as Array<{
      preset_id: string;
      ref: string;
      version_constraint: string;
      order: number;
      embed_on_export: number;
    }>;

  return rows.map((r) => ({
    preset_id: r.preset_id,
    ref: r.ref,
    version_constraint: r.version_constraint,
    order: r.order,
    embed_on_export: r.embed_on_export !== 0,
  }));
}
