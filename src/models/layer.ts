import { getDb } from "../db/connection.js";
import { ulid } from "ulid";
import semver from "semver";
import type {
  Layer,
  LayerDependency,
  Resource,
  ResourceType,
  ResourceMetadata,
  ClaudeLayerConfig,
} from "../types.js";
import { satisfiesConstraint, parseVersionConstraint } from "../services/plugin-constraints.js";

interface LayerRow {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string;
  claude_config: string;
  created_at: string;
  updated_at: string;
}

function parseClaudeConfig(raw: string | undefined): ClaudeLayerConfig | undefined {
  if (!raw || raw === "{}") return undefined;
  const parsed = JSON.parse(raw) as ClaudeLayerConfig;
  if (
    (!parsed.marketplaces || Object.keys(parsed.marketplaces).length === 0) &&
    (!parsed.plugins || parsed.plugins.length === 0)
  ) {
    return undefined;
  }
  return parsed;
}

function serializeClaudeConfig(config: ClaudeLayerConfig | undefined): string {
  if (!config) return "{}";
  return JSON.stringify(config);
}

function writeLayerClaudeConfig(
  layerId: string,
  config: ClaudeLayerConfig,
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE layers SET claude_config = ?, updated_at = ? WHERE id = ?`,
  ).run(serializeClaudeConfig(config), now, layerId);
}

/**
 * If the layer already carries Claude config, keep `claude.plugins` in sync with
 * layer plugin pins (Claude uses `id` as the plugin ref).
 */
export function syncClaudeLayerPluginsAfterAdd(
  layer: Layer,
  ref: string,
  versionConstraint: string,
): void {
  if (!layer.claude) return;
  const plugins = [...(layer.claude.plugins ?? [])];
  const idx = plugins.findIndex((p) => p.id === ref);
  const entry = { id: ref, version: versionConstraint };
  if (idx >= 0) {
    plugins[idx] = { ...plugins[idx], ...entry };
  } else {
    plugins.push(entry);
  }
  writeLayerClaudeConfig(layer.id, { ...layer.claude, plugins });
}

export function syncClaudeLayerPluginsAfterRemove(
  layer: Layer,
  ref: string,
): void {
  if (!layer.claude) return;
  const plugins = (layer.claude.plugins ?? []).filter((p) => p.id !== ref);
  writeLayerClaudeConfig(layer.id, { ...layer.claude, plugins });
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

function rowToLayer(row: LayerRow): Layer {
  const claude = parseClaudeConfig(row.claude_config);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    tags: JSON.parse(row.tags) as string[],
    ...(claude ? { claude } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createLayer(input: {
  name: string;
  version?: string;
  description?: string;
  tags?: string[];
  claude?: ClaudeLayerConfig;
}): Layer {
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();
  const version = input.version ?? "1.0.0";

  db.prepare(
    `INSERT INTO layers (id, name, version, description, tags, claude_config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    version,
    input.description ?? "",
    JSON.stringify(input.tags ?? []),
    serializeClaudeConfig(input.claude),
    now,
    now,
  );

  return {
    id,
    name: input.name,
    version,
    description: input.description ?? "",
    tags: input.tags ?? [],
    ...(input.claude ? { claude: input.claude } : {}),
    created_at: now,
    updated_at: now,
  };
}

// ── Selector parsing ─────────────────────────────────────────────────────

export type LayerSelector =
  | { kind: "id"; id: string }
  | { kind: "name"; name: string }
  | { kind: "name-version"; name: string; constraint: string };

/** Parse a layer selector string into its components.
 *
 * - `name@constraint` → name + semver constraint
 * - 26-char ULID-like string → id
 * - anything else → name (latest version)
 */
export function parseLayerSelector(selector: string): LayerSelector {
  const atIdx = selector.lastIndexOf("@");
  if (atIdx > 0) {
    return {
      kind: "name-version",
      name: selector.slice(0, atIdx),
      constraint: selector.slice(atIdx + 1),
    };
  }
  // ULID: 26 chars, uppercase letters and digits
  if (/^[0-9A-Z]{26}$/.test(selector)) {
    return { kind: "id", id: selector };
  }
  return { kind: "name", name: selector };
}

function getLayerById(id: string): Layer | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM layers WHERE id = ?").get(id) as LayerRow | undefined;
  return row ? rowToLayer(row) : undefined;
}

function getLayerLatestByName(name: string): Layer | undefined {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM layers WHERE name = ?").all(name) as LayerRow[];
  const first = rows[0];
  if (!first) return undefined;
  if (rows.length === 1) return rowToLayer(first);
  const sorted = [...rows].sort((a, b) => {
    try {
      return semver.rcompare(a.version, b.version);
    } catch {
      return 0;
    }
  });
  return sorted[0] ? rowToLayer(sorted[0]) : undefined;
}

function getLayerByNameAndConstraint(name: string, constraint: string): Layer | undefined {
  // Validate constraint upfront — throws Error for invalid semver range/version
  parseVersionConstraint(constraint);

  const db = getDb();
  const rows = db.prepare("SELECT * FROM layers WHERE name = ?").all(name) as LayerRow[];
  const matching = rows.filter((row) => satisfiesConstraint(constraint, row.version));
  if (matching.length === 0) return undefined;
  const sorted = [...matching].sort((a, b) => {
    try {
      return semver.rcompare(a.version, b.version);
    } catch {
      return 0;
    }
  });
  return sorted[0] ? rowToLayer(sorted[0]) : undefined;
}

export function getLayer(selector: string): Layer | undefined {
  const parsed = parseLayerSelector(selector);
  if (parsed.kind === "id") {
    return getLayerById(parsed.id);
  }
  if (parsed.kind === "name-version") {
    return getLayerByNameAndConstraint(parsed.name, parsed.constraint);
  }
  // name: return latest version, fallback to id lookup for backward compat
  return getLayerLatestByName(parsed.name) ?? getLayerById(selector);
}

export function listLayers(): Layer[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM layers ORDER BY name`)
    .all() as LayerRow[];
  return rows.map(rowToLayer);
}

export function deleteLayer(layerId: string): boolean {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM layers WHERE id = ?")
    .run(layerId);
  return result.changes > 0;
}

export function addResourceToLayer(layerId: string, resourceId: string): void {
  const db = getDb();
  const maxOrder = db
    .prepare(
      'SELECT COALESCE(MAX("order"), -1) as max_order FROM layer_resources WHERE layer_id = ?',
    )
    .get(layerId) as { max_order: number };

  db.prepare(
    'INSERT OR IGNORE INTO layer_resources (layer_id, resource_id, "order") VALUES (?, ?, ?)',
  ).run(layerId, resourceId, maxOrder.max_order + 1);
}

export function removeResourceFromLayer(layerId: string, resourceId: string): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM layer_resources WHERE layer_id = ? AND resource_id = ?",
  ).run(layerId, resourceId);
}

export function getLayerResources(layerId: string): Resource[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.*, pr."order" FROM resources r
       JOIN layer_resources pr ON pr.resource_id = r.id
       WHERE pr.layer_id = ?
       ORDER BY pr."order"`,
    )
    .all(layerId) as ResourceRow[];

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

// ── Dependency CRUD ──────────────────────────────────────────────────────

interface LayerDependencyRow {
  layer_id: string;
  dependency_name: string;
  version_constraint: string;
  order: number;
}

export function addDependencyToLayer(
  layerId: string,
  dependencyName: string,
  versionConstraint: string,
): void {
  const db = getDb();
  const maxOrder = db
    .prepare(
      'SELECT COALESCE(MAX("order"), -1) as max_order FROM layer_dependencies WHERE layer_id = ?',
    )
    .get(layerId) as { max_order: number };

  // ON CONFLICT: update only the constraint; preserve the existing order
  db.prepare(
    `INSERT INTO layer_dependencies (layer_id, dependency_name, version_constraint, "order")
     VALUES (?, ?, ?, ?)
     ON CONFLICT(layer_id, dependency_name) DO UPDATE SET version_constraint = excluded.version_constraint`,
  ).run(layerId, dependencyName, versionConstraint, maxOrder.max_order + 1);
}

export function listLayerDependencies(layerId: string): LayerDependency[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM layer_dependencies WHERE layer_id = ? ORDER BY "order"`,
    )
    .all(layerId) as LayerDependencyRow[];

  return rows.map((row) => ({
    layer_id: row.layer_id,
    dependency_name: row.dependency_name,
    version_constraint: row.version_constraint,
    order: row.order,
  }));
}

export function removeDependencyFromLayer(
  layerId: string,
  dependencyName: string,
): boolean {
  const db = getDb();
  const result = db.prepare(
    "DELETE FROM layer_dependencies WHERE layer_id = ? AND dependency_name = ?",
  ).run(layerId, dependencyName);
  return result.changes > 0;
}
