import { getDb } from "../db/connection.js";
import { ulid } from "ulid";
import semver from "semver";
import type {
  Preset,
  PresetDependency,
  Resource,
  ResourceType,
  ResourceMetadata,
  ClaudePresetConfig,
} from "../types.js";
import { satisfiesConstraint, parseVersionConstraint } from "../services/plugin-constraints.js";

interface PresetRow {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string;
  claude_config: string;
  created_at: string;
  updated_at: string;
}

function parseClaudeConfig(raw: string | undefined): ClaudePresetConfig | undefined {
  if (!raw || raw === "{}") return undefined;
  const parsed = JSON.parse(raw) as ClaudePresetConfig;
  if (
    (!parsed.marketplaces || Object.keys(parsed.marketplaces).length === 0) &&
    (!parsed.plugins || parsed.plugins.length === 0)
  ) {
    return undefined;
  }
  return parsed;
}

function serializeClaudeConfig(config: ClaudePresetConfig | undefined): string {
  if (!config) return "{}";
  return JSON.stringify(config);
}

function writePresetClaudeConfig(
  presetId: string,
  config: ClaudePresetConfig,
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE presets SET claude_config = ?, updated_at = ? WHERE id = ?`,
  ).run(serializeClaudeConfig(config), now, presetId);
}

/**
 * If the preset already carries Claude config, keep `claude.plugins` in sync with
 * preset plugin pins (Claude uses `id` as the plugin ref).
 */
export function syncClaudePresetPluginsAfterAdd(
  preset: Preset,
  ref: string,
  versionConstraint: string,
): void {
  if (!preset.claude) return;
  const plugins = [...(preset.claude.plugins ?? [])];
  const idx = plugins.findIndex((p) => p.id === ref);
  const entry = { id: ref, version: versionConstraint };
  if (idx >= 0) {
    plugins[idx] = { ...plugins[idx], ...entry };
  } else {
    plugins.push(entry);
  }
  writePresetClaudeConfig(preset.id, { ...preset.claude, plugins });
}

export function syncClaudePresetPluginsAfterRemove(
  preset: Preset,
  ref: string,
): void {
  if (!preset.claude) return;
  const plugins = (preset.claude.plugins ?? []).filter((p) => p.id !== ref);
  writePresetClaudeConfig(preset.id, { ...preset.claude, plugins });
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

export function createPreset(input: {
  name: string;
  version?: string;
  description?: string;
  tags?: string[];
  claude?: ClaudePresetConfig;
}): Preset {
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();
  const version = input.version ?? "1.0.0";

  db.prepare(
    `INSERT INTO presets (id, name, version, description, tags, claude_config, created_at, updated_at)
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

export type PresetSelector =
  | { kind: "id"; id: string }
  | { kind: "name"; name: string }
  | { kind: "name-version"; name: string; constraint: string };

/** Parse a preset selector string into its components.
 *
 * - `name@constraint` → name + semver constraint
 * - 26-char ULID-like string → id
 * - anything else → name (latest version)
 */
export function parsePresetSelector(selector: string): PresetSelector {
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

function getPresetById(id: string): Preset | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM presets WHERE id = ?").get(id) as PresetRow | undefined;
  return row ? rowToPreset(row) : undefined;
}

function getPresetLatestByName(name: string): Preset | undefined {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM presets WHERE name = ?").all(name) as PresetRow[];
  if (rows.length === 0) return undefined;
  if (rows.length === 1) return rowToPreset(rows[0]);
  const sorted = [...rows].sort((a, b) => {
    try {
      return semver.rcompare(a.version, b.version);
    } catch {
      return 0;
    }
  });
  return rowToPreset(sorted[0]);
}

function getPresetByNameAndConstraint(name: string, constraint: string): Preset | undefined {
  // Validate constraint upfront — throws Error for invalid semver range/version
  parseVersionConstraint(constraint);

  const db = getDb();
  const rows = db.prepare("SELECT * FROM presets WHERE name = ?").all(name) as PresetRow[];
  const matching = rows.filter((row) => satisfiesConstraint(constraint, row.version));
  if (matching.length === 0) return undefined;
  const sorted = [...matching].sort((a, b) => {
    try {
      return semver.rcompare(a.version, b.version);
    } catch {
      return 0;
    }
  });
  return rowToPreset(sorted[0]);
}

export function getPreset(selector: string): Preset | undefined {
  const parsed = parsePresetSelector(selector);
  if (parsed.kind === "id") {
    return getPresetById(parsed.id);
  }
  if (parsed.kind === "name-version") {
    return getPresetByNameAndConstraint(parsed.name, parsed.constraint);
  }
  // name: return latest version, fallback to id lookup for backward compat
  return getPresetLatestByName(parsed.name) ?? getPresetById(selector);
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

// ── Dependency CRUD ──────────────────────────────────────────────────────

interface PresetDependencyRow {
  preset_id: string;
  dependency_name: string;
  version_constraint: string;
  order: number;
}

export function addDependencyToPreset(
  presetId: string,
  dependencyName: string,
  versionConstraint: string,
): void {
  const db = getDb();
  const maxOrder = db
    .prepare(
      'SELECT COALESCE(MAX("order"), -1) as max_order FROM preset_dependencies WHERE preset_id = ?',
    )
    .get(presetId) as { max_order: number };

  // ON CONFLICT: update only the constraint; preserve the existing order
  db.prepare(
    `INSERT INTO preset_dependencies (preset_id, dependency_name, version_constraint, "order")
     VALUES (?, ?, ?, ?)
     ON CONFLICT(preset_id, dependency_name) DO UPDATE SET version_constraint = excluded.version_constraint`,
  ).run(presetId, dependencyName, versionConstraint, maxOrder.max_order + 1);
}

export function listPresetDependencies(presetId: string): PresetDependency[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM preset_dependencies WHERE preset_id = ? ORDER BY "order"`,
    )
    .all(presetId) as PresetDependencyRow[];

  return rows.map((row) => ({
    preset_id: row.preset_id,
    dependency_name: row.dependency_name,
    version_constraint: row.version_constraint,
    order: row.order,
  }));
}

export function removeDependencyFromPreset(
  presetId: string,
  dependencyName: string,
): boolean {
  const db = getDb();
  const result = db.prepare(
    "DELETE FROM preset_dependencies WHERE preset_id = ? AND dependency_name = ?",
  ).run(presetId, dependencyName);
  return result.changes > 0;
}
