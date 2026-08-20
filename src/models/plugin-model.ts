import { getDb } from "../db/connection.js";
import { ulid } from "ulid";
import semver from "semver";
import { mapResourceRow } from "./resource.js";
import {
  ensurePluginResource,
  listAttachedPluginRefs,
} from "../services/plugin-composition.js";
import { listDependencies } from "../services/plugin-dependency.js";
import { claudeConfigFromPluginPins } from "../services/claude-plugin-pins.js";
import { slugifyApName } from "../services/agent-plugins/name.js";
import type {
  ClaudeMarketplaceEntry,
  ClaudePluginEntry,
  ClaudePluginConfig,
  OriginFingerprintKind,
  Plugin,
  PluginDependencyRef,
  PluginOrigin,
  PluginOverrides,
  Resource,
} from "../types.js";
import { satisfiesConstraint, parseVersionConstraint } from "../services/plugin-constraints.js";

interface PluginRow {
  id: string;
  name: string;
  version: string;
  org_slug: string;
  catalog_slug: string;
  origin: string;
  description: string;
  tags: string;
  claude_config: string;
  needs_config: string;
  overrides: string;
  default_environment_id: string | null;
  ap_name: string;
  origin_locator?: string;
  origin_fingerprint?: string;
  origin_fingerprint_kind?: string;
  dirty?: number;
  frozen_at: string | null;
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

export interface MergedPluginContent {
  plugins: Plugin[];
  resources: Resource[];
  claude?: ClaudePluginConfig;
  pluginPins: Array<{ ref: string; version_constraint: string }>;
}

function parseClaudeConfig(raw: string | undefined): ClaudePluginConfig | undefined {
  if (!raw || raw === "{}") return undefined;
  const parsed = JSON.parse(raw) as ClaudePluginConfig;
  if (
    (!parsed.marketplaces || Object.keys(parsed.marketplaces).length === 0) &&
    (!parsed.plugins || parsed.plugins.length === 0)
  ) {
    return undefined;
  }
  return parsed;
}

function serializeClaudeConfig(config: ClaudePluginConfig | undefined): string {
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

function parseOverrides(raw: string | undefined): PluginOverrides | undefined {
  if (!raw || raw === "{}") return undefined;
  const parsed = JSON.parse(raw) as Partial<PluginOverrides>;
  const versions = parsed.versions ?? {};
  const resources = parsed.resources ?? {};
  if (Object.keys(versions).length === 0 && Object.keys(resources).length === 0) {
    return undefined;
  }
  return { versions, resources };
}

function rowToPlugin(row: PluginRow): Plugin {
  const claude = parseClaudeConfig(row.claude_config);
  const needs = parseNeedsConfig(row.needs_config);
  const overrides = parseOverrides(row.overrides);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    org_slug: row.org_slug,
    catalog_slug: row.catalog_slug,
    origin: (row.origin as PluginOrigin) ?? "authored",
    description: row.description,
    tags: JSON.parse(row.tags) as string[],
    dirty: row.dirty === 1,
    ...(row.frozen_at ? { frozen_at: row.frozen_at } : {}),
    ...(claude ? { claude } : {}),
    ...(needs ? { needs } : {}),
    ...(overrides ? { overrides } : {}),
    ...(row.default_environment_id
      ? { default_environment_id: row.default_environment_id }
      : {}),
    ...(row.ap_name ? { ap_name: row.ap_name } : {}),
    ...(row.origin_locator ? { origin_locator: row.origin_locator } : {}),
    ...(row.origin_fingerprint ? { origin_fingerprint: row.origin_fingerprint } : {}),
    ...(row.origin_fingerprint_kind
      ? { origin_fingerprint_kind: row.origin_fingerprint_kind as OriginFingerprintKind }
      : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function isFrozenPlugin(plugin: Plugin): boolean {
  return plugin.frozen_at != null;
}

function writePluginClaudeConfig(pluginId: string, config: ClaudePluginConfig): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE plugins SET claude_config = ?, updated_at = ? WHERE id = ?`,
  ).run(serializeClaudeConfig(config), now, pluginId);
}

function resourceKey(resource: Pick<Resource, "type" | "name">): string {
  return `${resource.type}:${resource.name}`;
}

function mergeClaudeConfig(
  base: ClaudePluginConfig | undefined,
  next: ClaudePluginConfig | undefined,
): ClaudePluginConfig | undefined {
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

function listPluginPins(pluginId: string): Array<{
  ref: string;
  version_constraint: string;
}> {
  return listDependencies(pluginId).map((dependency) => ({
    ref: dependency.ref,
    version_constraint: dependency.version_constraint,
  }));
}

/**
 * Merge multiple plugins by id in order; later plugins override earlier
 * ones for resources (by type:name), plugin pins (by ref), and Claude config.
 */
export function mergePluginsById(pluginIds: string[]): MergedPluginContent {
  const plugins: Plugin[] = [];
  const resourceOrder: string[] = [];
  const resourceByKey = new Map<string, Resource>();
  const pluginPins = new Map<string, { ref: string; version_constraint: string }>();
  let claude: ClaudePluginConfig | undefined;

  for (const pluginId of pluginIds) {
    const plugin = getPluginById(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }
    plugins.push(plugin);

    for (const resource of getPluginResources(plugin.id)) {
      if (resource.type === "plugin") {
        continue;
      }
      const key = resourceKey(resource);
      if (!resourceByKey.has(key)) {
        resourceOrder.push(key);
      }
      resourceByKey.set(key, resource);
    }

    for (const pin of listPluginPins(plugin.id)) {
      pluginPins.set(pin.ref, pin);
    }

    claude = mergeClaudeConfig(claude, plugin.claude);
  }

  const resources = resourceOrder
    .map((key) => resourceByKey.get(key))
    .filter((r): r is Resource => r !== undefined);

  const mergedPins = [...pluginPins.values()];
  claude = mergeClaudeConfig(claude, claudeConfigFromPluginPins(mergedPins));

  return {
    plugins,
    resources,
    claude,
    pluginPins: mergedPins,
  };
}

function copyResourcesToPlugin(pluginId: string, resources: Resource[]): void {
  const db = getDb();
  let order = 0;
  for (const resource of resources) {
    db.prepare(
      `INSERT OR REPLACE INTO plugin_resources (plugin_id, resource_id, "order")
       VALUES (?, ?, ?)`,
    ).run(pluginId, resource.id, order);
    order += 1;
  }
}

function copyPluginCompositionFromSources(
  targetPluginId: string,
  sourcePluginIds: string[],
): void {
  const db = getDb();
  const maxOrderRow = db
    .prepare(
      'SELECT COALESCE(MAX("order"), -1) as max_order FROM plugin_resources WHERE plugin_id = ?',
    )
    .get(targetPluginId) as { max_order: number };
  let nextOrder = maxOrderRow.max_order + 1;

  const seenComposition = new Set<string>();
  for (const sourcePluginId of sourcePluginIds) {
    const rows = db
      .prepare(
        `SELECT r.id, r.type, r.name
         FROM resources r
         JOIN plugin_resources lr ON lr.resource_id = r.id
         WHERE lr.plugin_id = ?
         ORDER BY lr."order"`,
      )
      .all(sourcePluginId) as Array<{ id: string; type: string; name: string }>;

    for (const row of rows) {
      if (row.type !== "plugin_pin" && row.type !== "plugin") continue;
      const key = `${row.type}:${row.id}`;
      if (seenComposition.has(key)) continue;
      seenComposition.add(key);
      db.prepare(
        `INSERT OR IGNORE INTO plugin_resources (plugin_id, resource_id, "order")
         VALUES (?, ?, ?)`,
      ).run(targetPluginId, row.id, nextOrder);
      nextOrder += 1;
    }
  }
}

export function createPlugin(input: {
  name: string;
  version?: string;
  description?: string;
  tags?: string[];
  claude?: ClaudePluginConfig;
  needs?: string[];
  org_slug?: string;
  catalog_slug?: string;
  origin?: PluginOrigin;
  default_environment_id?: string;
}): Plugin {
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();
  const version = input.version ?? "1.0.0";
  const origin = input.origin ?? "authored";

  db.prepare(
    `INSERT INTO plugins (
      id, name, version, org_slug, catalog_slug, origin, description, tags,
      claude_config, needs_config, default_environment_id, dirty, frozen_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    version,
    input.org_slug ?? "",
    input.catalog_slug ?? "",
    origin,
    input.description ?? "",
    JSON.stringify(input.tags ?? []),
    serializeClaudeConfig(input.claude),
    serializeNeedsConfig(input.needs),
    input.default_environment_id ?? null,
    0,
    null,
    now,
    now,
  );

  return {
    id,
    name: input.name,
    version,
    org_slug: input.org_slug ?? "",
    catalog_slug: input.catalog_slug ?? "",
    origin,
    description: input.description ?? "",
    tags: input.tags ?? [],
    dirty: false,
    ...(input.claude ? { claude: input.claude } : {}),
    ...(input.needs && input.needs.length > 0 ? { needs: input.needs } : {}),
    ...(input.default_environment_id
      ? { default_environment_id: input.default_environment_id }
      : {}),
    created_at: now,
    updated_at: now,
  };
}

export function stampPluginOrigin(
  pluginId: string,
  input: {
    locator: string;
    fingerprint?: string;
    fingerprintKind?: OriginFingerprintKind | "";
  },
): void {
  const db = getDb();
  db.prepare(
    `UPDATE plugins
     SET origin_locator = ?, origin_fingerprint = ?, origin_fingerprint_kind = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.locator,
    input.fingerprint ?? "",
    input.fingerprintKind ?? "",
    new Date().toISOString(),
    pluginId,
  );
}

export function bumpPluginWorkingVersion(pluginId: string, version: string): void {
  const plugin = getPluginById(pluginId);
  if (!plugin) {
    throw new Error(`Plugin not found: ${pluginId}`);
  }

  const db = getDb();
  const sibling = db
    .prepare(
      `SELECT id, frozen_at FROM plugins
       WHERE org_slug = ? AND catalog_slug = ? AND name = ? AND version = ? AND id != ?`,
    )
    .get(plugin.org_slug, plugin.catalog_slug, plugin.name, version, pluginId) as
      | { id: string; frozen_at: string | null }
      | undefined;

  if (sibling?.frozen_at) {
    throw new Error(
      `Cannot bump ${plugin.name} to ${version}: that version already exists as a frozen cut`,
    );
  }

  db.prepare("UPDATE plugins SET version = ?, updated_at = ? WHERE id = ?").run(
    version,
    new Date().toISOString(),
    pluginId,
  );
}

export function updatePluginPublishedIdentity(
  pluginId: string,
  input: { org_slug: string; catalog_slug: string; version?: string },
): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE plugins
       SET org_slug = ?, catalog_slug = ?,
           version = COALESCE(?, version),
           updated_at = ?
       WHERE id = ?`,
    )
    .run(input.org_slug, input.catalog_slug, input.version ?? null, now, pluginId);
  return result.changes > 0;
}

export function updatePluginCatalogIdentity(
  pluginId: string,
  input: { org_slug: string; catalog_slug: string },
): boolean {
  return updatePluginPublishedIdentity(pluginId, input);
}

export type PluginSelector =
  | { kind: "id"; id: string }
  | { kind: "name"; name: string }
  | { kind: "name-version"; name: string; constraint: string };

export function parsePluginSelectorString(selector: string): PluginSelector {
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

export function getPluginById(id: string): Plugin | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM plugins WHERE id = ?").get(id) as
    | PluginRow
    | undefined;
  return row ? rowToPlugin(row) : undefined;
}

function sortPluginsByVersionDesc(rows: PluginRow[]): PluginRow[] {
  return [...rows].sort((a, b) => {
    try {
      return semver.rcompare(a.version, b.version);
    } catch {
      return 0;
    }
  });
}

function preferLocalPluginRows(rows: PluginRow[]): PluginRow[] {
  const localRows = rows.filter(
    (row) => row.org_slug === "" && row.catalog_slug === "",
  );
  return localRows.length > 0 ? localRows : rows;
}

function getPluginLatestByName(name: string): Plugin | undefined {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM plugins WHERE name = ?`)
    .all(name) as PluginRow[];
  const candidates = preferLocalPluginRows(rows);
  const sorted = sortPluginsByVersionDesc(candidates);
  return sorted[0] ? rowToPlugin(sorted[0]) : undefined;
}

function getPluginByNameAndConstraint(
  name: string,
  constraint: string,
): Plugin | undefined {
  parseVersionConstraint(constraint);

  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM plugins WHERE name = ?`)
    .all(name) as PluginRow[];
  const matching = preferLocalPluginRows(rows).filter((row) =>
    satisfiesConstraint(constraint, row.version),
  );
  if (matching.length === 0) return undefined;
  const sorted = sortPluginsByVersionDesc(matching);
  return sorted[0] ? rowToPlugin(sorted[0]) : undefined;
}

export function getPlugin(selector: string): Plugin | undefined {
  const parsed = parsePluginSelectorString(selector);
  if (parsed.kind === "id") {
    return getPluginById(parsed.id);
  }
  if (parsed.kind === "name-version") {
    return getPluginByNameAndConstraint(parsed.name, parsed.constraint);
  }
  return getPluginLatestByName(parsed.name) ?? getPluginById(selector);
}

export function getPluginByName(
  name: string,
  version?: string,
): Plugin | undefined {
  if (version) {
    const db = getDb();
    const rows = db
      .prepare(`SELECT * FROM plugins WHERE name = ? AND version = ?`)
      .all(name, version) as PluginRow[];
    const row = preferLocalPluginRows(rows)[0];
    return row ? rowToPlugin(row) : undefined;
  }
  return getPluginLatestByName(name);
}

export function getPluginByPublishedIdentity(input: {
  name: string;
  version: string;
  org?: string;
  catalog?: string;
}): Plugin | undefined {
  const orgSlug = input.org ?? "";
  const catalogSlug = input.catalog ?? "";

  if (orgSlug || catalogSlug) {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM plugins
         WHERE name = ? AND version = ? AND org_slug = ? AND catalog_slug = ?`,
      )
      .all(input.name, input.version, orgSlug, catalogSlug) as PluginRow[];
    return rows[0] ? rowToPlugin(rows[0]) : undefined;
  }

  return getPluginByName(input.name, input.version);
}

export function getPluginByCatalogVersion(
  org: string,
  catalog: string,
  version: string,
): Plugin | undefined {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM plugins WHERE org_slug = ? AND catalog_slug = ? AND version = ?`,
    )
    .all(org, catalog, version) as PluginRow[];
  const row = preferLocalPluginRows(rows)[0];
  return row ? rowToPlugin(row) : undefined;
}

export function listLatestPublishedPluginsBySlug(slug: string): Plugin[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM plugins WHERE name = ?`)
    .all(slug) as PluginRow[];
  const published = rows.filter(
    (row) => row.org_slug !== "" || row.catalog_slug !== "",
  );
  const latestByIdentity = new Map<string, PluginRow>();
  for (const row of published) {
    const key = `${row.org_slug}/${row.catalog_slug}`;
    const existing = latestByIdentity.get(key);
    if (!existing) {
      latestByIdentity.set(key, row);
      continue;
    }
    try {
      if (semver.rcompare(row.version, existing.version) > 0) {
        latestByIdentity.set(key, row);
      }
    } catch {
      latestByIdentity.set(key, row);
    }
  }
  return [...latestByIdentity.values()].map(rowToPlugin);
}

export function formatPublishedPluginSelector(plugin: Pick<Plugin, "org_slug" | "catalog_slug" | "name" | "version">): string {
  return `${plugin.org_slug}/${plugin.catalog_slug}/${plugin.name}@${plugin.version}`;
}

export function isSamePublishedPluginIdentity(
  plugin: Pick<Plugin, "org_slug" | "catalog_slug" | "name">,
  identity: { org_slug: string; catalog_slug: string; plugin_slug: string },
): boolean {
  return plugin.org_slug === identity.org_slug
    && plugin.catalog_slug === identity.catalog_slug
    && plugin.name === identity.plugin_slug;
}

export function listPlugins(): Plugin[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM plugins ORDER BY name, version`)
    .all() as PluginRow[];
  return rows.map(rowToPlugin);
}

export function listPluginsAttachingResource(resourceId: string): Plugin[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.* FROM plugins p
       JOIN plugin_resources pr ON pr.plugin_id = p.id
       WHERE pr.resource_id = ?
       ORDER BY p.name, p.version`,
    )
    .all(resourceId) as PluginRow[];
  return rows.map(rowToPlugin);
}

export function deletePlugin(pluginId: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM plugins WHERE id = ?").run(pluginId);
  return result.changes > 0;
}

export function addResourceToPlugin(pluginId: string, resourceId: string): void {
  const db = getDb();
  const maxOrder = db
    .prepare(
      'SELECT COALESCE(MAX("order"), -1) as max_order FROM plugin_resources WHERE plugin_id = ?',
    )
    .get(pluginId) as { max_order: number };

  db.prepare(
    'INSERT OR IGNORE INTO plugin_resources (plugin_id, resource_id, "order") VALUES (?, ?, ?)',
  ).run(pluginId, resourceId, maxOrder.max_order + 1);
}

export function removeResourceFromPlugin(pluginId: string, resourceId: string): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM plugin_resources WHERE plugin_id = ? AND resource_id = ?",
  ).run(pluginId, resourceId);
}

export function setPluginResourceOrder(pluginId: string, resourceIds: string[]): void {
  const db = getDb();
  const applyOrder = db.transaction((ids: string[]) => {
    for (let order = 0; order < ids.length; order += 1) {
      db.prepare(
        'UPDATE plugin_resources SET "order" = ? WHERE plugin_id = ? AND resource_id = ?',
      ).run(order, pluginId, ids[order]);
    }
  });
  applyOrder(resourceIds);
}

export function touchPluginUpdatedAt(pluginId: string): void {
  const db = getDb();
  db.prepare("UPDATE plugins SET updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    pluginId,
  );
}

export function getPluginResources(pluginId: string): Resource[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.*, lr."order" FROM resources r
       JOIN plugin_resources lr ON lr.resource_id = r.id
       WHERE lr.plugin_id = ?
       ORDER BY lr."order"`,
    )
    .all(pluginId) as ResourceRow[];

  return rows.map(mapResourceRow);
}

export function ensurePluginClaudeMarketplace(
  plugin: Plugin,
  marketplaceName: string,
  entry: ClaudeMarketplaceEntry,
): boolean {
  if (plugin.claude?.marketplaces?.[marketplaceName]) {
    return false;
  }
  const marketplaces = {
    ...(plugin.claude?.marketplaces ?? {}),
    [marketplaceName]: entry,
  };
  writePluginClaudeConfig(plugin.id, {
    ...(plugin.claude ?? {}),
    marketplaces,
  });
  return true;
}

export function syncClaudeMarketplacePluginsAfterAdd(
  plugin: Plugin,
  ref: string,
  versionConstraint: string,
): void {
  const plugins = [...(plugin.claude?.plugins ?? [])];
  const idx = plugins.findIndex((p) => p.id === ref);
  const entry = { id: ref, version: versionConstraint, enabled: true as const };
  if (idx >= 0) {
    plugins[idx] = { ...plugins[idx], ...entry };
  } else {
    plugins.push(entry);
  }
  writePluginClaudeConfig(plugin.id, {
    ...(plugin.claude ?? {}),
    plugins,
  });
}

export function syncClaudeMarketplacePluginsAfterRemove(plugin: Plugin, ref: string): void {
  if (!plugin.claude) return;
  const plugins = (plugin.claude.plugins ?? []).filter((p) => p.id !== ref);
  writePluginClaudeConfig(plugin.id, { ...plugin.claude, plugins });
}

export function addDependencyToPlugin(
  pluginId: string,
  dependencyName: string,
  versionConstraint: string,
): void {
  for (const ref of listAttachedPluginRefs(pluginId)) {
    if (ref.dependency_name === dependencyName) {
      removeResourceFromPlugin(pluginId, ref.resource.id);
    }
  }

  const constraint =
    versionConstraint === "latest" || versionConstraint === "*"
      ? undefined
      : versionConstraint;
  const resource = ensurePluginResource(`plugin:${dependencyName}`, {
    versionConstraint: constraint,
  });
  addResourceToPlugin(pluginId, resource.id);
}

export function listPluginDependencies(pluginId: string): PluginDependencyRef[] {
  return listAttachedPluginRefs(pluginId).map((ref, index) => ({
    plugin_id: pluginId,
    dependency_name: ref.dependency_name,
    version_constraint: ref.version_constraint,
    order: index,
  }));
}

export function removeDependencyFromPlugin(
  pluginId: string,
  dependencyName: string,
): boolean {
  const attached = listAttachedPluginRefs(pluginId).filter(
    (ref) => ref.dependency_name === dependencyName,
  );
  if (attached.length === 0) {
    return false;
  }
  for (const ref of attached) {
    removeResourceFromPlugin(pluginId, ref.resource.id);
  }
  return true;
}

export function setPluginDefaultEnvironment(
  pluginId: string,
  environmentId: string | null,
): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE plugins SET default_environment_id = ?, updated_at = ? WHERE id = ?`,
    )
    .run(environmentId, now, pluginId);
  return result.changes > 0;
}

export function setPluginTags(
  pluginId: string,
  tags: string[],
): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE plugins SET tags = ?, updated_at = ? WHERE id = ?`,
    )
    .run(JSON.stringify([...new Set(tags)]), now, pluginId);
  return result.changes > 0;
}

export function setPluginApName(pluginId: string, apName: string): boolean {
  const db = getDb();
  const result = db
    .prepare("UPDATE plugins SET ap_name = ?, updated_at = ? WHERE id = ?")
    .run(apName, new Date().toISOString(), pluginId);
  return result.changes > 0;
}

/** The AP package name: the stored override, or a slug of the local name. */
export function resolveApName(plugin: Pick<Plugin, "name" | "ap_name">): string {
  return plugin.ap_name && plugin.ap_name !== ""
    ? plugin.ap_name
    : slugifyApName(plugin.name);
}

export function updatePluginName(pluginId: string, name: string): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(`UPDATE plugins SET name = ?, updated_at = ? WHERE id = ?`)
    .run(name, now, pluginId);
  return result.changes > 0;
}

export function updatePluginDescription(
  pluginId: string,
  description: string,
): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(`UPDATE plugins SET description = ?, updated_at = ? WHERE id = ?`)
    .run(description, now, pluginId);
  return result.changes > 0;
}

export function createPluginFromSources(input: {
  name: string;
  version?: string;
  description?: string;
  sourcePluginIds: string[];
  environmentId?: string;
}): Plugin {
  if (input.sourcePluginIds.length === 0) {
    return createPlugin({
      name: input.name,
      version: input.version,
      description: input.description,
      ...(input.environmentId ? { default_environment_id: input.environmentId } : {}),
    });
  }

  if (input.sourcePluginIds.length === 1) {
    const sourceId = input.sourcePluginIds[0];
    if (!sourceId) {
      throw new Error("sourcePluginIds must include at least one plugin id");
    }
    const source = getPluginById(sourceId);
    if (!source) {
      throw new Error(`Plugin not found: ${sourceId}`);
    }
    const version = input.version ?? source.version;
    if (input.name === source.name && version === source.version) {
      if (input.environmentId) {
        setPluginDefaultEnvironment(sourceId, input.environmentId);
      }
      const refreshed = getPluginById(sourceId);
      if (!refreshed) {
        throw new Error(`Plugin ${sourceId} not found after update`);
      }
      return refreshed;
    }
  }

  const merged = mergePluginsById(input.sourcePluginIds);
  const tags = [...new Set(merged.plugins.flatMap((plugin) => plugin.tags))];
  const needs = [
    ...new Set(merged.plugins.flatMap((plugin) => plugin.needs ?? [])),
  ];

  const plugin = createPlugin({
    name: input.name,
    version: input.version,
    description: input.description ?? merged.plugins[0]?.description ?? "",
    tags,
    ...(merged.claude ? { claude: merged.claude } : {}),
    ...(needs.length > 0 ? { needs } : {}),
    ...(input.environmentId ? { default_environment_id: input.environmentId } : {}),
  });

  copyResourcesToPlugin(plugin.id, merged.resources);
  copyPluginCompositionFromSources(plugin.id, input.sourcePluginIds);

  const refreshed = getPluginById(plugin.id);
  if (!refreshed) {
    throw new Error(`Plugin ${plugin.id} not found after merge create`);
  }
  return refreshed;
}

export function resolvePluginSelector(selector: string): Plugin | undefined {
  if (/^[0-9A-Z]{26}$/.test(selector)) {
    return getPluginById(selector);
  }
  const atIdx = selector.lastIndexOf("@");
  if (atIdx > 0) {
    return getPluginByName(selector.slice(0, atIdx), selector.slice(atIdx + 1));
  }
  const asPlugin = getPluginByName(selector);
  if (asPlugin) return asPlugin;
  return getPlugin(selector);
}

/** Every locally available version for a plugin name, newest first. */
export function listPluginVersions(name: string): string[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT version FROM plugins WHERE name = ?")
    .all(name) as Array<{ version: string }>;
  const versions = rows
    .map((row) => row.version)
    .filter((version) => version.length > 0 && version !== "unknown");
  const semverVersions = versions
    .filter((version) => semver.valid(version) !== null)
    .sort(semver.rcompare);
  const nonSemver = versions.filter((version) => semver.valid(version) === null);
  return [...semverVersions, ...nonSemver];
}

// Transitional aliases — Task 4 rewrites call sites; then remove these.
/** @deprecated Use MergedPluginContent */
export type MergedLayerContent = MergedPluginContent;
/** @deprecated Use isFrozenPlugin */
export const isFrozenLayer = isFrozenPlugin;
/** @deprecated Use mergePluginsById */
export const mergeLayersById = mergePluginsById;
/** @deprecated Use createPlugin */
export const createLayer = createPlugin;
/** @deprecated Use updatePluginPublishedIdentity */
export const updateLayerPublishedIdentity = updatePluginPublishedIdentity;
/** @deprecated Use updatePluginCatalogIdentity */
export const updateLayerCatalogIdentity = updatePluginCatalogIdentity;
/** @deprecated Use PluginSelector */
export type LayerSelector = PluginSelector;
/** @deprecated Use parsePluginSelectorString */
export const parseLayerSelectorString = parsePluginSelectorString;
/** @deprecated Use getPluginById */
export const getLayerById = getPluginById;
/** @deprecated Use getPlugin */
export const getLayer = getPlugin;
/** @deprecated Use getPluginByName */
export const getLayerByName = getPluginByName;
/** @deprecated Use getPluginByPublishedIdentity */
export const getLayerByPublishedIdentity = getPluginByPublishedIdentity;
/** @deprecated Use getPluginByCatalogVersion */
export const getLayerByCatalogVersion = getPluginByCatalogVersion;
/** @deprecated Use listLatestPublishedPluginsBySlug */
export const listLatestPublishedLayersBySlug = listLatestPublishedPluginsBySlug;
/** @deprecated Use formatPublishedPluginSelector */
export const formatPublishedLayerSelector = formatPublishedPluginSelector;
/** @deprecated Use isSamePublishedPluginIdentity */
export const isSamePublishedLayerIdentity = isSamePublishedPluginIdentity;
/** @deprecated Use listPlugins */
export const listLayers = listPlugins;
/** @deprecated Use deletePlugin */
export const deleteLayer = deletePlugin;
/** @deprecated Use addResourceToPlugin */
export const addResourceToLayer = addResourceToPlugin;
/** @deprecated Use removeResourceFromPlugin */
export const removeResourceFromLayer = removeResourceFromPlugin;
/** @deprecated Use setPluginResourceOrder */
export const setLayerResourceOrder = setPluginResourceOrder;
/** @deprecated Use touchPluginUpdatedAt */
export const touchLayerUpdatedAt = touchPluginUpdatedAt;
/** @deprecated Use getPluginResources */
export const getLayerResources = getPluginResources;
/** @deprecated Use ensurePluginClaudeMarketplace */
export const ensureLayerClaudeMarketplace = ensurePluginClaudeMarketplace;
/** @deprecated Use syncClaudeMarketplacePluginsAfterAdd */
export const syncClaudeLayerPluginsAfterAdd = syncClaudeMarketplacePluginsAfterAdd;
/** @deprecated Use syncClaudeMarketplacePluginsAfterRemove */
export const syncClaudeLayerPluginsAfterRemove = syncClaudeMarketplacePluginsAfterRemove;
/** @deprecated Use addDependencyToPlugin */
export const addDependencyToLayer = addDependencyToPlugin;
/** @deprecated Use listPluginDependencies */
export const listLayerDependencies = listPluginDependencies;
/** @deprecated Use removeDependencyFromPlugin */
export const removeDependencyFromLayer = removeDependencyFromPlugin;
/** @deprecated Use setPluginDefaultEnvironment */
export const setLayerDefaultEnvironment = setPluginDefaultEnvironment;
/** @deprecated Use setPluginTags */
export const setLayerTags = setPluginTags;
/** @deprecated Use updatePluginName */
export const updateLayerName = updatePluginName;
/** @deprecated Use updatePluginDescription */
export const updateLayerDescription = updatePluginDescription;
/** @deprecated Use createPluginFromSources */
export const createLayerFromSources = createPluginFromSources;
/** @deprecated Use resolvePluginSelector */
export const resolveLayerSelector = resolvePluginSelector;
/** @deprecated Use listPluginVersions */
export const listLayerVersions = listPluginVersions;
