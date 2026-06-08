import { getDb } from "../db/connection.js";
import { ulid } from "ulid";
import type { ConfiguredLayer, ConfiguredLayerPlugin } from "../types.js";
import { getPlugin } from "./plugin-component.js";

interface ConfiguredLayerRow {
  id: string;
  name: string;
  version: string;
  description: string;
  default_environment_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToConfiguredLayer(row: ConfiguredLayerRow): ConfiguredLayer {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    ...(row.default_environment_id
      ? { default_environment_id: row.default_environment_id }
      : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createConfiguredLayer(input: {
  name: string;
  version?: string;
  description?: string;
  pluginIds: string[];
  environmentId?: string;
}): ConfiguredLayer {
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();
  const version = input.version ?? "1.0.0";

  db.prepare(
    `INSERT INTO configured_layers (id, name, version, description, default_environment_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    version,
    input.description ?? "",
    input.environmentId ?? null,
    now,
    now,
  );

  for (let i = 0; i < input.pluginIds.length; i++) {
    const pluginId = input.pluginIds[i];
    if (!pluginId) continue;
    db.prepare(
      `INSERT INTO configured_layer_plugins (configured_layer_id, plugin_id, "order")
       VALUES (?, ?, ?)`,
    ).run(id, pluginId, i);
  }

  return {
    id,
    name: input.name,
    version,
    description: input.description ?? "",
    ...(input.environmentId ? { default_environment_id: input.environmentId } : {}),
    created_at: now,
    updated_at: now,
  };
}

export function getConfiguredLayer(id: string): ConfiguredLayer | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM configured_layers WHERE id = ?")
    .get(id) as ConfiguredLayerRow | undefined;
  return row ? rowToConfiguredLayer(row) : undefined;
}

export function getConfiguredLayerByName(
  name: string,
  version?: string,
): ConfiguredLayer | undefined {
  const db = getDb();
  if (version) {
    const row = db
      .prepare("SELECT * FROM configured_layers WHERE name = ? AND version = ?")
      .get(name, version) as ConfiguredLayerRow | undefined;
    return row ? rowToConfiguredLayer(row) : undefined;
  }
  const row = db
    .prepare(
      "SELECT * FROM configured_layers WHERE name = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(name) as ConfiguredLayerRow | undefined;
  return row ? rowToConfiguredLayer(row) : undefined;
}

export function listConfiguredLayers(): ConfiguredLayer[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM configured_layers ORDER BY name, version")
    .all() as ConfiguredLayerRow[];
  return rows.map(rowToConfiguredLayer);
}

export function setConfiguredLayerDefaultEnvironment(
  configuredLayerId: string,
  environmentId: string | null,
): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE configured_layers
       SET default_environment_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(environmentId, now, configuredLayerId);
  return result.changes > 0;
}

export function unsetConfiguredLayerDefaultEnvironment(
  configuredLayerId: string,
): boolean {
  return setConfiguredLayerDefaultEnvironment(configuredLayerId, null);
}

export function listConfiguredLayerPlugins(
  configuredLayerId: string,
): ConfiguredLayerPlugin[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT configured_layer_id, plugin_id, "order" as "order"
       FROM configured_layer_plugins
       WHERE configured_layer_id = ?
       ORDER BY "order"`,
    )
    .all(configuredLayerId) as ConfiguredLayerPlugin[];
}

export function findConfiguredLayerForPlugin(
  pluginId: string,
): ConfiguredLayer | undefined {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT cl.*
       FROM configured_layers cl
       WHERE (
         SELECT COUNT(*) FROM configured_layer_plugins
         WHERE configured_layer_id = cl.id
       ) = 1
       AND (
         SELECT plugin_id FROM configured_layer_plugins
         WHERE configured_layer_id = cl.id
         LIMIT 1
       ) = ?
       ORDER BY cl.created_at DESC
       LIMIT 1`,
    )
    .get(pluginId) as ConfiguredLayerRow | undefined;
  return row ? rowToConfiguredLayer(row) : undefined;
}

/** Wrap a design plugin in a single-plugin configured layer for legacy apply targets. */
export function ensureImplicitConfiguredLayer(pluginId: string): ConfiguredLayer {
  const existing = findConfiguredLayerForPlugin(pluginId);
  if (existing) return existing;

  const plugin = getPlugin(pluginId);
  if (!plugin) {
    throw new Error(`Plugin not found: ${pluginId}`);
  }

  return createConfiguredLayer({
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    pluginIds: [plugin.id],
  });
}

export function resolveConfiguredLayerSelector(selector: string): ConfiguredLayer | undefined {
  if (/^[0-9A-Z]{26}$/.test(selector)) {
    return getConfiguredLayer(selector);
  }
  const atIdx = selector.lastIndexOf("@");
  if (atIdx > 0) {
    return getConfiguredLayerByName(selector.slice(0, atIdx), selector.slice(atIdx + 1));
  }
  const asLayer = getConfiguredLayerByName(selector);
  if (asLayer) return asLayer;

  const plugin = getPlugin(selector);
  if (plugin) {
    return ensureImplicitConfiguredLayer(plugin.id);
  }

  return undefined;
}
