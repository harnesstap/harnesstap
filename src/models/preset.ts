import { getDb } from "../db/connection.js";
import { ulid } from "ulid";
import type { Preset, Resource, ResourceType, ResourceMetadata } from "../types.js";

interface PresetRow {
  id: string;
  name: string;
  description: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

interface ResourceRow {
  id: string;
  type: string;
  name: string;
  description: string;
  content: string;
  metadata: string;
  source: string;
  created_at: string;
  updated_at: string;
  order: number;
}

function rowToPreset(row: PresetRow): Preset {
  return {
    ...row,
    tags: JSON.parse(row.tags) as string[],
  };
}

export function createPreset(input: {
  name: string;
  description?: string;
  tags?: string[];
}): Preset {
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();

  db.prepare(
    `INSERT INTO presets (id, name, description, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.description ?? "",
    JSON.stringify(input.tags ?? []),
    now,
    now,
  );

  return {
    id,
    name: input.name,
    description: input.description ?? "",
    tags: input.tags ?? [],
    created_at: now,
    updated_at: now,
  };
}

export function getPreset(nameOrId: string): Preset | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM presets WHERE id = ? OR name = ?")
    .get(nameOrId, nameOrId) as PresetRow | undefined;
  return row ? rowToPreset(row) : undefined;
}

export function listPresets(): Preset[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM presets ORDER BY name`)
    .all() as PresetRow[];
  return rows.map(rowToPreset);
}

export function deletePreset(nameOrId: string): boolean {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM presets WHERE id = ? OR name = ?")
    .run(nameOrId, nameOrId);
  return result.changes > 0;
}

export function addResourceToPreset(presetId: string, resourceId: string): void {
  const db = getDb();
  const maxOrder = db
    .prepare(
      'SELECT COALESCE(MAX("order"), -1) as max_order FROM preset_resources WHERE preset_id = ?',
    )
    .get(presetId) as { max_order: number };

  db.prepare(
    'INSERT OR IGNORE INTO preset_resources (preset_id, resource_id, "order") VALUES (?, ?, ?)',
  ).run(presetId, resourceId, maxOrder.max_order + 1);
}

export function removeResourceFromPreset(presetId: string, resourceId: string): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM preset_resources WHERE preset_id = ? AND resource_id = ?",
  ).run(presetId, resourceId);
}

export function getPresetResources(presetId: string): Resource[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.*, pr."order" FROM resources r
       JOIN preset_resources pr ON pr.resource_id = r.id
       WHERE pr.preset_id = ?
       ORDER BY pr."order"`,
    )
    .all(presetId) as ResourceRow[];

  return rows.map((row) => ({
    id: row.id,
    type: row.type as ResourceType,
    name: row.name,
    description: row.description,
    content: row.content,
    metadata: JSON.parse(row.metadata) as ResourceMetadata,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}
