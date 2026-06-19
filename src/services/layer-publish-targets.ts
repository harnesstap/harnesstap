import {
  loadRegisteredCatalogs,
  publishCatalogKey,
  type RegisteredCatalog,
} from "../config/catalog.js";
import { getDb } from "../db/connection.js";

export type LayerPublishBindingMode = "all_registered" | "explicit";

export interface LayerCatalogBindingsView {
  layer: string;
  mode: LayerPublishBindingMode;
  registered: RegisteredCatalog[];
  effective: RegisteredCatalog[];
  allowList: RegisteredCatalog[];
}

interface PublishTargetRow {
  org_slug: string;
  catalog_slug: string;
}

export function listLayerPublishTargets(layerId: string): RegisteredCatalog[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT org_slug, catalog_slug
       FROM layer_publish_targets
       WHERE layer_id = ?
       ORDER BY org_slug, catalog_slug`,
    )
    .all(layerId) as PublishTargetRow[];

  return rows.map((row) => ({
    org: row.org_slug,
    catalog: row.catalog_slug,
  }));
}

export function getLayerPublishBindingMode(layerId: string): LayerPublishBindingMode {
  return listLayerPublishTargets(layerId).length === 0 ? "all_registered" : "explicit";
}

export function setLayerPublishTargets(
  layerId: string,
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
    db.prepare("DELETE FROM layer_publish_targets WHERE layer_id = ?").run(layerId);
    const insert = db.prepare(
      `INSERT INTO layer_publish_targets (layer_id, org_slug, catalog_slug, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    for (const target of uniqueTargets.values()) {
      insert.run(layerId, target.org, target.catalog, now);
    }
  })();
}

export function clearLayerPublishTargets(layerId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM layer_publish_targets WHERE layer_id = ?").run(layerId);
}

export function removeLayerPublishTarget(
  layerId: string,
  target: Pick<RegisteredCatalog, "org" | "catalog">,
): boolean {
  const db = getDb();
  const result = db
    .prepare(
      `DELETE FROM layer_publish_targets
       WHERE layer_id = ? AND org_slug = ? AND catalog_slug = ?`,
    )
    .run(layerId, target.org, target.catalog);
  return result.changes > 0;
}

export function resolvePublishTargets(layerId: string): RegisteredCatalog[] {
  const registered = loadRegisteredCatalogs();
  const allowList = listLayerPublishTargets(layerId);
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

export function buildLayerCatalogBindingsView(layer: {
  id: string;
  name: string;
}): LayerCatalogBindingsView {
  const registered = loadRegisteredCatalogs();
  const allowList = listLayerPublishTargets(layer.id);
  const effective = resolvePublishTargets(layer.id);

  return {
    layer: layer.name,
    mode: allowList.length === 0 ? "all_registered" : "explicit",
    registered,
    effective,
    allowList,
  };
}

export function assertResolvablePublishTargets(layerId: string): RegisteredCatalog[] {
  const registered = loadRegisteredCatalogs();
  if (registered.length === 0) {
    throw new Error(
      "No publish catalogs registered. Run `hd layer catalog register org/catalog` first.",
    );
  }

  const effective = resolvePublishTargets(layerId);
  if (effective.length === 0) {
    throw new Error(
      "No effective publish catalogs for this layer. Update bindings with `hd layer catalog bindings <layer>`.",
    );
  }

  const allowList = listLayerPublishTargets(layerId);
  const registeredKeys = new Set(registered.map((entry) => publishCatalogKey(entry)));
  const missing = allowList.filter((entry) => !registeredKeys.has(publishCatalogKey(entry)));
  if (missing.length > 0) {
    const labels = missing.map((entry) => `${entry.org}/${entry.catalog}`).join(", ");
    console.warn(`Warning: skipping unregistered publish catalogs: ${labels}`);
  }

  return effective;
}
