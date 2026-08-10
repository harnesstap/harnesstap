import {
  loadRegisteredCatalogs,
  publishCatalogKey,
  type RegisteredCatalog,
} from "../config/catalog.js";
import { getDb } from "../db/connection.js";

export type PluginPublishBindingMode = "all_registered" | "explicit";

export interface PluginCatalogBindingsView {
  plugin: string;
  mode: PluginPublishBindingMode;
  registered: RegisteredCatalog[];
  effective: RegisteredCatalog[];
  allowList: RegisteredCatalog[];
}

interface PublishTargetRow {
  org_slug: string;
  catalog_slug: string;
}

export function listPluginPublishTargets(pluginId: string): RegisteredCatalog[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT org_slug, catalog_slug
       FROM plugin_publish_targets
       WHERE plugin_id = ?
       ORDER BY org_slug, catalog_slug`,
    )
    .all(pluginId) as PublishTargetRow[];

  return rows.map((row) => ({
    org: row.org_slug,
    catalog: row.catalog_slug,
  }));
}

export function getPluginPublishBindingMode(pluginId: string): PluginPublishBindingMode {
  return listPluginPublishTargets(pluginId).length === 0 ? "all_registered" : "explicit";
}

export function setPluginPublishTargets(
  pluginId: string,
  targets: RegisteredCatalog[],
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const uniqueTargets = new Map<string, RegisteredCatalog>();
  for (const target of targets) {
    uniqueTargets.set(publishCatalogKey(target), {
      org: target.org,
      catalog: target.catalog,
    });
  }

  db.transaction(() => {
    db.prepare("DELETE FROM plugin_publish_targets WHERE plugin_id = ?").run(pluginId);
    const insert = db.prepare(
      `INSERT INTO plugin_publish_targets (plugin_id, org_slug, catalog_slug, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    for (const target of uniqueTargets.values()) {
      insert.run(pluginId, target.org, target.catalog, now);
    }
  })();
}

export function clearPluginPublishTargets(pluginId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM plugin_publish_targets WHERE plugin_id = ?").run(pluginId);
}

export function removePluginPublishTarget(
  pluginId: string,
  target: Pick<RegisteredCatalog, "org" | "catalog">,
): boolean {
  const db = getDb();
  const result = db
    .prepare(
      `DELETE FROM plugin_publish_targets
       WHERE plugin_id = ? AND org_slug = ? AND catalog_slug = ?`,
    )
    .run(pluginId, target.org, target.catalog);
  return result.changes > 0;
}

export function resolvePublishTargets(pluginId: string): RegisteredCatalog[] {
  const registered = loadRegisteredCatalogs();
  const allowList = listPluginPublishTargets(pluginId);
  if (allowList.length === 0) {
    return registered;
  }

  const registeredByKey = new Map(
    registered.map((entry) => [publishCatalogKey(entry), entry] as const),
  );

  const effective: RegisteredCatalog[] = [];
  for (const target of allowList) {
    const registeredEntry = registeredByKey.get(publishCatalogKey(target));
    if (registeredEntry) {
      effective.push(registeredEntry);
    }
  }
  return effective;
}

export function buildPluginCatalogBindingsView(plugin: {
  id: string;
  name: string;
}): PluginCatalogBindingsView {
  const registered = loadRegisteredCatalogs();
  const allowList = listPluginPublishTargets(plugin.id);
  const effective = resolvePublishTargets(plugin.id);

  return {
    plugin: plugin.name,
    mode: allowList.length === 0 ? "all_registered" : "explicit",
    registered,
    effective,
    allowList,
  };
}

export function assertResolvablePublishTargets(pluginId: string): RegisteredCatalog[] {
  const registered = loadRegisteredCatalogs();
  if (registered.length === 0) {
    throw new Error(
      "No publish catalogs registered. Run `ht plugin catalog register org/catalog` first.",
    );
  }

  const effective = resolvePublishTargets(pluginId);
  if (effective.length === 0) {
    throw new Error(
      "No effective publish catalogs for this plugin. Update bindings with `ht plugin catalog bindings <plugin>`.",
    );
  }

  const allowList = listPluginPublishTargets(pluginId);
  const registeredKeys = new Set(registered.map((entry) => publishCatalogKey(entry)));
  const missing = allowList.filter((entry) => !registeredKeys.has(publishCatalogKey(entry)));
  if (missing.length > 0) {
    const labels = missing.map((entry) => `${entry.org}/${entry.catalog}`).join(", ");
    console.warn(`Warning: skipping unregistered publish catalogs: ${labels}`);
  }

  return effective;
}
