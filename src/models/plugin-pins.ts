import { getDb } from "../db/connection.js";

export interface LayerPluginRow {
  layer_id: string;
  ref: string;
  version_constraint: string;
  order: number;
  embed_on_export: boolean;
}

export function addPluginToLayer(
  layerId: string,
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
        'SELECT COALESCE(MAX("order"), -1) as max_order FROM plugin_native_pins WHERE layer_id = ?',
      )
      .get(layerId) as { max_order: number };
    order = maxOrder.max_order + 1;
  }

  db.prepare(
    `INSERT INTO plugin_native_pins (layer_id, ref, version_constraint, "order", embed_on_export)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(layer_id, ref) DO UPDATE SET
       version_constraint = excluded.version_constraint,
       "order" = excluded."order",
       embed_on_export = excluded.embed_on_export`,
  ).run(layerId, ref, versionConstraint, order, embed);
}

export function removePluginFromLayer(layerId: string, ref: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM plugin_native_pins WHERE layer_id = ? AND ref = ?`).run(
    layerId,
    ref,
  );
}

export function listLayerPlugins(layerId: string): LayerPluginRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT layer_id, ref, version_constraint, "order", embed_on_export
       FROM plugin_native_pins
       WHERE layer_id = ?
       ORDER BY "order" ASC`,
    )
    .all(layerId) as Array<{
      layer_id: string;
      ref: string;
      version_constraint: string;
      order: number;
      embed_on_export: number;
    }>;

  return rows.map((r) => ({
    layer_id: r.layer_id,
    ref: r.ref,
    version_constraint: r.version_constraint,
    order: r.order,
    embed_on_export: r.embed_on_export !== 0,
  }));
}
