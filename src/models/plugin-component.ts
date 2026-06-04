import { getDb } from "../db/connection.js";
import { ulid } from "ulid";
import semver from "semver";
import type {
  Plugin,
  LayerDependency,
  Resource,
  ResourceType,
  ResourceMetadata,
  ClaudeLayerConfig,
} from "../types.js";
import { satisfiesConstraint, parseVersionConstraint } from "../services/plugin-constraints.js";

interface PluginRow {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string;
  claude_config: string;
  needs_config: string;
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

function parseNeedsConfig(raw: string | undefined): string[] | undefined {
  if (!raw || raw === "[]") return undefined;
  const parsed = JSON.parse(raw) as string[];
  return parsed.length > 0 ? parsed : undefined;
}

function serializeNeedsConfig(needs: string[] | undefined): string {
  return JSON.stringify(needs ?? []);
}

function writePluginClaudeConfig(
  pluginId: string,
  config: ClaudeLayerConfig,
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE plugins SET claude_config = ?, updated_at = ? WHERE id = ?`,
  ).run(serializeClaudeConfig(config), now, pluginId);
}

/**
 * If the plugin already carries Claude config, keep `claude.plugins` in sync with
 * native plugin pins (Claude uses `id` as the plugin ref).
 */
export function syncClaudeLayerPluginsAfterAdd(
  plugin: Plugin,
  ref: string,
  versionConstraint: string,
): void {
  if (!plugin.claude) return;
  const plugins = [...(plugin.claude.plugins ?? [])];
  const idx = plugins.findIndex((p) => p.id === ref);
  const entry = { id: ref, version: versionConstraint };
  if (idx >= 0) {
    plugins[idx] = { ...plugins[idx], ...entry };
  } else {
    plugins.push(entry);
  }
  writePluginClaudeConfig(plugin.id, { ...plugin.claude, plugins });
}

export function syncClaudeLayerPluginsAfterRemove(
  plugin: Plugin,
  ref: string,
): void {
  if (!plugin.claude) return;
  const plugins = (plugin.claude.plugins ?? []).filter((p) => p.id !== ref);
  writePluginClaudeConfig(plugin.id, { ...plugin.claude, plugins });
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

function rowToPlugin(row: PluginRow): Plugin {
  const claude = parseClaudeConfig(row.claude_config);
  const needs = parseNeedsConfig(row.needs_config);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    tags: JSON.parse(row.tags) as string[],
    ...(claude ? { claude } : {}),
    ...(needs ? { needs } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createPlugin(input: {
  name: string;
  version?: string;
  description?: string;
  tags?: string[];
  claude?: ClaudeLayerConfig;
  needs?: string[];
}): Plugin {
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();
  const version = input.version ?? "1.0.0";

  db.prepare(
    `INSERT INTO plugins (id, name, version, description, tags, claude_config, needs_config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    version,
    input.description ?? "",
    JSON.stringify(input.tags ?? []),
    serializeClaudeConfig(input.claude),
    serializeNeedsConfig(input.needs),
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
    ...(input.needs && input.needs.length > 0 ? { needs: input.needs } : {}),
    created_at: now,
    updated_at: now,
  };
}

// ── Selector parsing ─────────────────────────────────────────────────────

export type PluginSelector =
  | { kind: "id"; id: string }
  | { kind: "name"; name: string }
  | { kind: "name-version"; name: string; constraint: string };

/** Parse a plugin selector string into its components.
 *
 * - `name@constraint` → name + semver constraint
 * - 26-char ULID-like string → id
 * - anything else → name (latest version)
 */
export function parsePluginSelector(selector: string): PluginSelector {
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

/** @deprecated Use parsePluginSelector */
export const parseLayerSelector = parsePluginSelector;

function getPluginById(id: string): Plugin | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM plugins WHERE id = ?").get(id) as PluginRow | undefined;
  return row ? rowToPlugin(row) : undefined;
}

function getPluginLatestByName(name: string): Plugin | undefined {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM plugins WHERE name = ?").all(name) as PluginRow[];
  const first = rows[0];
  if (!first) return undefined;
  if (rows.length === 1) return rowToPlugin(first);
  const sorted = [...rows].sort((a, b) => {
    try {
      return semver.rcompare(a.version, b.version);
    } catch {
      return 0;
    }
  });
  return sorted[0] ? rowToPlugin(sorted[0]) : undefined;
}

function getPluginByNameAndConstraint(name: string, constraint: string): Plugin | undefined {
  parseVersionConstraint(constraint);

  const db = getDb();
  const rows = db.prepare("SELECT * FROM plugins WHERE name = ?").all(name) as PluginRow[];
  const matching = rows.filter((row) => satisfiesConstraint(constraint, row.version));
  if (matching.length === 0) return undefined;
  const sorted = [...matching].sort((a, b) => {
    try {
      return semver.rcompare(a.version, b.version);
    } catch {
      return 0;
    }
  });
  return sorted[0] ? rowToPlugin(sorted[0]) : undefined;
}

export function getPlugin(selector: string): Plugin | undefined {
  const parsed = parsePluginSelector(selector);
  if (parsed.kind === "id") {
    return getPluginById(parsed.id);
  }
  if (parsed.kind === "name-version") {
    return getPluginByNameAndConstraint(parsed.name, parsed.constraint);
  }
  return getPluginLatestByName(parsed.name) ?? getPluginById(selector);
}

export function listPlugins(): Plugin[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM plugins ORDER BY name`)
    .all() as PluginRow[];
  return rows.map(rowToPlugin);
}

export function deletePlugin(pluginId: string): boolean {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM plugins WHERE id = ?")
    .run(pluginId);
  return result.changes > 0;
}

export function addResourceToPlugin(pluginId: string, resourceId: string): void {
  const db = getDb();
  const maxOrder = db
    .prepare(
      'SELECT COALESCE(MAX("order"), -1) as max_order FROM plugin_resources WHERE layer_id = ?',
    )
    .get(pluginId) as { max_order: number };

  db.prepare(
    'INSERT OR IGNORE INTO plugin_resources (layer_id, resource_id, "order") VALUES (?, ?, ?)',
  ).run(pluginId, resourceId, maxOrder.max_order + 1);
}

export function removeResourceFromPlugin(pluginId: string, resourceId: string): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM plugin_resources WHERE layer_id = ? AND resource_id = ?",
  ).run(pluginId, resourceId);
}

export function getPluginResources(pluginId: string): Resource[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.*, pr."order" FROM resources r
       JOIN plugin_resources pr ON pr.resource_id = r.id
       WHERE pr.layer_id = ?
       ORDER BY pr."order"`,
    )
    .all(pluginId) as ResourceRow[];

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

interface PluginDependencyRow {
  layer_id: string;
  dependency_name: string;
  version_constraint: string;
  order: number;
}

export function addDependencyToPlugin(
  pluginId: string,
  dependencyName: string,
  versionConstraint: string,
): void {
  const db = getDb();
  const maxOrder = db
    .prepare(
      'SELECT COALESCE(MAX("order"), -1) as max_order FROM plugin_dependencies WHERE layer_id = ?',
    )
    .get(pluginId) as { max_order: number };

  db.prepare(
    `INSERT INTO plugin_dependencies (layer_id, dependency_name, version_constraint, "order")
     VALUES (?, ?, ?, ?)
     ON CONFLICT(layer_id, dependency_name) DO UPDATE SET version_constraint = excluded.version_constraint`,
  ).run(pluginId, dependencyName, versionConstraint, maxOrder.max_order + 1);
}

export function listPluginDependencies(pluginId: string): LayerDependency[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM plugin_dependencies WHERE layer_id = ? ORDER BY "order"`,
    )
    .all(pluginId) as PluginDependencyRow[];

  return rows.map((row) => ({
    layer_id: row.layer_id,
    dependency_name: row.dependency_name,
    version_constraint: row.version_constraint,
    order: row.order,
  }));
}

export function removeDependencyFromPlugin(
  pluginId: string,
  dependencyName: string,
): boolean {
  const db = getDb();
  const result = db.prepare(
    "DELETE FROM plugin_dependencies WHERE layer_id = ? AND dependency_name = ?",
  ).run(pluginId, dependencyName);
  return result.changes > 0;
}
