import { getDb } from "../db/connection.js";
import { ulid } from "ulid";
import semver from "semver";
import { mapResourceRow } from "./resource.js";
import {
  ensureLayerResource,
  listAttachedLayerRefs,
  listAttachedPluginPins,
} from "../services/layer-composition.js";
import { claudeConfigFromPluginPins } from "../services/claude-plugin-pins.js";
import type {
  ClaudePluginEntry,
  ClaudeLayerConfig,
  Layer,
  LayerDependency,
  Resource,
} from "../types.js";
import { satisfiesConstraint, parseVersionConstraint } from "../services/plugin-constraints.js";

interface LayerRow {
  id: string;
  name: string;
  version: string;
  org_slug: string;
  catalog_slug: string;
  description: string;
  tags: string;
  claude_config: string;
  needs_config: string;
  default_environment_id: string | null;
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
  namespace?: string;
  origin_kind?: string;
  origin_ref?: string;
  content_hash?: string;
  content_blob_ref?: string;
  created_at: string;
  updated_at: string;
  order: number;
}

export interface MergedLayerContent {
  layers: Layer[];
  resources: Resource[];
  claude?: ClaudeLayerConfig;
  pluginPins: Array<{ ref: string; version_constraint: string }>;
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

function rowToLayer(row: LayerRow): Layer {
  const claude = parseClaudeConfig(row.claude_config);
  const needs = parseNeedsConfig(row.needs_config);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    org_slug: row.org_slug,
    catalog_slug: row.catalog_slug,
    description: row.description,
    tags: JSON.parse(row.tags) as string[],
    ...(claude ? { claude } : {}),
    ...(needs ? { needs } : {}),
    ...(row.default_environment_id
      ? { default_environment_id: row.default_environment_id }
      : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function writeLayerClaudeConfig(layerId: string, config: ClaudeLayerConfig): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE layers SET claude_config = ?, updated_at = ? WHERE id = ?`,
  ).run(serializeClaudeConfig(config), now, layerId);
}

function resourceKey(resource: Pick<Resource, "type" | "name">): string {
  return `${resource.type}:${resource.name}`;
}

function mergeClaudeConfig(
  base: ClaudeLayerConfig | undefined,
  next: ClaudeLayerConfig | undefined,
): ClaudeLayerConfig | undefined {
  if (!base && !next) return undefined;
  const marketplaces = {
    ...(base?.marketplaces ?? {}),
    ...(next?.marketplaces ?? {}),
  };
  const pluginMap = new Map<string, ClaudePluginEntry>();
  for (const p of base?.plugins ?? []) {
    pluginMap.set(p.id, p);
  }
  for (const p of next?.plugins ?? []) {
    pluginMap.set(p.id, p);
  }
  const plugins = [...pluginMap.values()];
  return {
    ...(Object.keys(marketplaces).length > 0 ? { marketplaces } : {}),
    ...(plugins.length > 0 ? { plugins } : {}),
  };
}

function listLayerPluginPins(layerId: string): Array<{
  ref: string;
  version_constraint: string;
}> {
  return listAttachedPluginPins(layerId).map((pin) => ({
    ref: pin.ref,
    version_constraint: pin.version_constraint,
  }));
}

/**
 * Merge multiple layers by id in order; later layers override earlier
 * ones for resources (by type:name), plugin pins (by ref), and Claude config.
 */
export function mergeLayersById(layerIds: string[]): MergedLayerContent {
  const layers: Layer[] = [];
  const resourceOrder: string[] = [];
  const resourceByKey = new Map<string, Resource>();
  const pluginPins = new Map<string, { ref: string; version_constraint: string }>();
  let claude: ClaudeLayerConfig | undefined;

  for (const layerId of layerIds) {
    const layer = getLayerById(layerId);
    if (!layer) {
      throw new Error(`Layer not found: ${layerId}`);
    }
    layers.push(layer);

    for (const resource of getLayerResources(layer.id)) {
      if (resource.type === "plugin_pin" || resource.type === "layer") {
        continue;
      }
      const key = resourceKey(resource);
      if (!resourceByKey.has(key)) {
        resourceOrder.push(key);
      }
      resourceByKey.set(key, resource);
    }

    for (const pin of listLayerPluginPins(layer.id)) {
      pluginPins.set(pin.ref, pin);
    }

    claude = mergeClaudeConfig(claude, layer.claude);
  }

  const resources = resourceOrder
    .map((key) => resourceByKey.get(key))
    .filter((r): r is Resource => r !== undefined);

  const mergedPins = [...pluginPins.values()];
  claude = mergeClaudeConfig(claude, claudeConfigFromPluginPins(mergedPins));

  return {
    layers,
    resources,
    claude,
    pluginPins: mergedPins,
  };
}

function copyResourcesToLayer(layerId: string, resources: Resource[]): void {
  const db = getDb();
  let order = 0;
  for (const resource of resources) {
    db.prepare(
      `INSERT OR REPLACE INTO layer_resources (layer_id, resource_id, "order")
       VALUES (?, ?, ?)`,
    ).run(layerId, resource.id, order);
    order += 1;
  }
}

function copyLayerCompositionFromSources(
  targetLayerId: string,
  sourceLayerIds: string[],
): void {
  const db = getDb();
  const maxOrderRow = db
    .prepare(
      'SELECT COALESCE(MAX("order"), -1) as max_order FROM layer_resources WHERE layer_id = ?',
    )
    .get(targetLayerId) as { max_order: number };
  let nextOrder = maxOrderRow.max_order + 1;

  const seenComposition = new Set<string>();
  for (const sourceLayerId of sourceLayerIds) {
    const rows = db
      .prepare(
        `SELECT r.id, r.type, r.name
         FROM resources r
         JOIN layer_resources lr ON lr.resource_id = r.id
         WHERE lr.layer_id = ?
         ORDER BY lr."order"`,
      )
      .all(sourceLayerId) as Array<{ id: string; type: string; name: string }>;

    for (const row of rows) {
      if (row.type !== "plugin_pin" && row.type !== "layer") continue;
      const key = `${row.type}:${row.id}`;
      if (seenComposition.has(key)) continue;
      seenComposition.add(key);
      db.prepare(
        `INSERT OR IGNORE INTO layer_resources (layer_id, resource_id, "order")
         VALUES (?, ?, ?)`,
      ).run(targetLayerId, row.id, nextOrder);
      nextOrder += 1;
    }
  }
}

export function createLayer(input: {
  name: string;
  version?: string;
  description?: string;
  tags?: string[];
  claude?: ClaudeLayerConfig;
  needs?: string[];
  org_slug?: string;
  catalog_slug?: string;
  default_environment_id?: string;
}): Layer {
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();
  const version = input.version ?? "1.0.0";

  db.prepare(
    `INSERT INTO layers (
      id, name, version, org_slug, catalog_slug, description, tags,
      claude_config, needs_config, default_environment_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    version,
    input.org_slug ?? "",
    input.catalog_slug ?? "",
    input.description ?? "",
    JSON.stringify(input.tags ?? []),
    serializeClaudeConfig(input.claude),
    serializeNeedsConfig(input.needs),
    input.default_environment_id ?? null,
    now,
    now,
  );

  return {
    id,
    name: input.name,
    version,
    org_slug: input.org_slug ?? "",
    catalog_slug: input.catalog_slug ?? "",
    description: input.description ?? "",
    tags: input.tags ?? [],
    ...(input.claude ? { claude: input.claude } : {}),
    ...(input.needs && input.needs.length > 0 ? { needs: input.needs } : {}),
    ...(input.default_environment_id
      ? { default_environment_id: input.default_environment_id }
      : {}),
    created_at: now,
    updated_at: now,
  };
}

export function updateLayerPublishedIdentity(
  layerId: string,
  input: { org_slug: string; catalog_slug: string; version?: string },
): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE layers
       SET org_slug = ?, catalog_slug = ?,
           version = COALESCE(?, version),
           updated_at = ?
       WHERE id = ?`,
    )
    .run(input.org_slug, input.catalog_slug, input.version ?? null, now, layerId);
  return result.changes > 0;
}

export function updateLayerCatalogIdentity(
  layerId: string,
  input: { org_slug: string; catalog_slug: string },
): boolean {
  return updateLayerPublishedIdentity(layerId, input);
}

export type LayerSelector =
  | { kind: "id"; id: string }
  | { kind: "name"; name: string }
  | { kind: "name-version"; name: string; constraint: string };

export function parseLayerSelectorString(selector: string): LayerSelector {
  const atIdx = selector.lastIndexOf("@");
  if (atIdx > 0) {
    return {
      kind: "name-version",
      name: selector.slice(0, atIdx),
      constraint: selector.slice(atIdx + 1),
    };
  }
  if (/^[0-9A-Z]{26}$/.test(selector)) {
    return { kind: "id", id: selector };
  }
  return { kind: "name", name: selector };
}

export function getLayerById(id: string): Layer | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM layers WHERE id = ?").get(id) as
    | LayerRow
    | undefined;
  return row ? rowToLayer(row) : undefined;
}

function sortLayersByVersionDesc(rows: LayerRow[]): LayerRow[] {
  return [...rows].sort((a, b) => {
    try {
      return semver.rcompare(a.version, b.version);
    } catch {
      return 0;
    }
  });
}

function preferLocalLayerRows(rows: LayerRow[]): LayerRow[] {
  const localRows = rows.filter(
    (row) => row.org_slug === "" && row.catalog_slug === "",
  );
  return localRows.length > 0 ? localRows : rows;
}

function getLayerLatestByName(name: string): Layer | undefined {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM layers WHERE name = ?`)
    .all(name) as LayerRow[];
  const candidates = preferLocalLayerRows(rows);
  const sorted = sortLayersByVersionDesc(candidates);
  return sorted[0] ? rowToLayer(sorted[0]) : undefined;
}

function getLayerByNameAndConstraint(
  name: string,
  constraint: string,
): Layer | undefined {
  parseVersionConstraint(constraint);

  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM layers WHERE name = ?`)
    .all(name) as LayerRow[];
  const matching = preferLocalLayerRows(rows).filter((row) =>
    satisfiesConstraint(constraint, row.version),
  );
  if (matching.length === 0) return undefined;
  const sorted = sortLayersByVersionDesc(matching);
  return sorted[0] ? rowToLayer(sorted[0]) : undefined;
}

export function getLayer(selector: string): Layer | undefined {
  const parsed = parseLayerSelectorString(selector);
  if (parsed.kind === "id") {
    return getLayerById(parsed.id);
  }
  if (parsed.kind === "name-version") {
    return getLayerByNameAndConstraint(parsed.name, parsed.constraint);
  }
  return getLayerLatestByName(parsed.name) ?? getLayerById(selector);
}

export function getLayerByName(
  name: string,
  version?: string,
): Layer | undefined {
  if (version) {
    const db = getDb();
    const rows = db
      .prepare(`SELECT * FROM layers WHERE name = ? AND version = ?`)
      .all(name, version) as LayerRow[];
    const row = preferLocalLayerRows(rows)[0];
    return row ? rowToLayer(row) : undefined;
  }
  return getLayerLatestByName(name);
}

export function getLayerByPublishedIdentity(input: {
  name: string;
  version: string;
  org?: string;
  catalog?: string;
}): Layer | undefined {
  const orgSlug = input.org ?? "";
  const catalogSlug = input.catalog ?? "";

  if (orgSlug || catalogSlug) {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM layers
         WHERE name = ? AND version = ? AND org_slug = ? AND catalog_slug = ?`,
      )
      .all(input.name, input.version, orgSlug, catalogSlug) as LayerRow[];
    return rows[0] ? rowToLayer(rows[0]) : undefined;
  }

  return getLayerByName(input.name, input.version);
}

export function getLayerByCatalogVersion(
  org: string,
  catalog: string,
  version: string,
): Layer | undefined {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM layers WHERE org_slug = ? AND catalog_slug = ? AND version = ?`,
    )
    .all(org, catalog, version) as LayerRow[];
  const row = preferLocalLayerRows(rows)[0];
  return row ? rowToLayer(row) : undefined;
}

export function listLayers(): Layer[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM layers ORDER BY name, version`)
    .all() as LayerRow[];
  return rows.map(rowToLayer);
}

export function deleteLayer(layerId: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM layers WHERE id = ?").run(layerId);
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

export function setLayerResourceOrder(layerId: string, resourceIds: string[]): void {
  const db = getDb();
  const applyOrder = db.transaction((ids: string[]) => {
    for (let order = 0; order < ids.length; order += 1) {
      db.prepare(
        'UPDATE layer_resources SET "order" = ? WHERE layer_id = ? AND resource_id = ?',
      ).run(order, layerId, ids[order]);
    }
  });
  applyOrder(resourceIds);
}

export function touchLayerUpdatedAt(layerId: string): void {
  const db = getDb();
  db.prepare("UPDATE layers SET updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    layerId,
  );
}

export function getLayerResources(layerId: string): Resource[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.*, lr."order" FROM resources r
       JOIN layer_resources lr ON lr.resource_id = r.id
       WHERE lr.layer_id = ?
       ORDER BY lr."order"`,
    )
    .all(layerId) as ResourceRow[];

  return rows.map(mapResourceRow);
}

export function syncClaudeLayerPluginsAfterAdd(
  layer: Layer,
  ref: string,
  versionConstraint: string,
): void {
  const plugins = [...(layer.claude?.plugins ?? [])];
  const idx = plugins.findIndex((p) => p.id === ref);
  const entry = { id: ref, version: versionConstraint, enabled: true as const };
  if (idx >= 0) {
    plugins[idx] = { ...plugins[idx], ...entry };
  } else {
    plugins.push(entry);
  }
  writeLayerClaudeConfig(layer.id, {
    ...(layer.claude ?? {}),
    plugins,
  });
}

export function syncClaudeLayerPluginsAfterRemove(layer: Layer, ref: string): void {
  if (!layer.claude) return;
  const plugins = (layer.claude.plugins ?? []).filter((p) => p.id !== ref);
  writeLayerClaudeConfig(layer.id, { ...layer.claude, plugins });
}

export function addDependencyToLayer(
  layerId: string,
  dependencyName: string,
  versionConstraint: string,
): void {
  for (const ref of listAttachedLayerRefs(layerId)) {
    if (ref.dependency_name === dependencyName) {
      removeResourceFromLayer(layerId, ref.resource.id);
    }
  }

  const constraint =
    versionConstraint === "latest" || versionConstraint === "*"
      ? undefined
      : versionConstraint;
  const resource = ensureLayerResource(`layer:${dependencyName}`, {
    versionConstraint: constraint,
  });
  addResourceToLayer(layerId, resource.id);
}

export function listLayerDependencies(layerId: string): LayerDependency[] {
  return listAttachedLayerRefs(layerId).map((ref, index) => ({
    layer_id: layerId,
    dependency_name: ref.dependency_name,
    version_constraint: ref.version_constraint,
    order: index,
  }));
}

export function removeDependencyFromLayer(
  layerId: string,
  dependencyName: string,
): boolean {
  const attached = listAttachedLayerRefs(layerId).filter(
    (ref) => ref.dependency_name === dependencyName,
  );
  if (attached.length === 0) {
    return false;
  }
  for (const ref of attached) {
    removeResourceFromLayer(layerId, ref.resource.id);
  }
  return true;
}

export function setLayerDefaultEnvironment(
  layerId: string,
  environmentId: string | null,
): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE layers SET default_environment_id = ?, updated_at = ? WHERE id = ?`,
    )
    .run(environmentId, now, layerId);
  return result.changes > 0;
}

export function setLayerTags(
  layerId: string,
  tags: string[],
): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE layers SET tags = ?, updated_at = ? WHERE id = ?`,
    )
    .run(JSON.stringify([...new Set(tags)]), now, layerId);
  return result.changes > 0;
}

export function createLayerFromSources(input: {
  name: string;
  version?: string;
  description?: string;
  sourceLayerIds: string[];
  environmentId?: string;
}): Layer {
  if (input.sourceLayerIds.length === 0) {
    return createLayer({
      name: input.name,
      version: input.version,
      description: input.description,
      ...(input.environmentId ? { default_environment_id: input.environmentId } : {}),
    });
  }

  if (input.sourceLayerIds.length === 1) {
    const sourceId = input.sourceLayerIds[0];
    if (!sourceId) {
      throw new Error("sourceLayerIds must include at least one layer id");
    }
    const source = getLayerById(sourceId);
    if (!source) {
      throw new Error(`Layer not found: ${sourceId}`);
    }
    const version = input.version ?? source.version;
    if (input.name === source.name && version === source.version) {
      if (input.environmentId) {
        setLayerDefaultEnvironment(sourceId, input.environmentId);
      }
      const refreshed = getLayerById(sourceId);
      if (!refreshed) {
        throw new Error(`Layer ${sourceId} not found after update`);
      }
      return refreshed;
    }
  }

  const merged = mergeLayersById(input.sourceLayerIds);
  const tags = [...new Set(merged.layers.flatMap((layer) => layer.tags))];
  const needs = [
    ...new Set(merged.layers.flatMap((layer) => layer.needs ?? [])),
  ];

  const layer = createLayer({
    name: input.name,
    version: input.version,
    description: input.description ?? merged.layers[0]?.description ?? "",
    tags,
    ...(merged.claude ? { claude: merged.claude } : {}),
    ...(needs.length > 0 ? { needs } : {}),
    ...(input.environmentId ? { default_environment_id: input.environmentId } : {}),
  });

  copyResourcesToLayer(layer.id, merged.resources);
  copyLayerCompositionFromSources(layer.id, input.sourceLayerIds);

  const refreshed = getLayerById(layer.id);
  if (!refreshed) {
    throw new Error(`Layer ${layer.id} not found after merge create`);
  }
  return refreshed;
}

export function resolveLayerSelector(selector: string): Layer | undefined {
  if (/^[0-9A-Z]{26}$/.test(selector)) {
    return getLayerById(selector);
  }
  const atIdx = selector.lastIndexOf("@");
  if (atIdx > 0) {
    return getLayerByName(selector.slice(0, atIdx), selector.slice(atIdx + 1));
  }
  const asLayer = getLayerByName(selector);
  if (asLayer) return asLayer;
  return getLayer(selector);
}
