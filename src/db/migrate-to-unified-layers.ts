import type { SqliteDatabase } from "./types.js";
import type { ClaudeLayerConfig } from "../types.js";

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

interface ConfiguredLayerRow {
  id: string;
  name: string;
  version: string;
  description: string;
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
  namespace: string;
  origin_kind: string;
  origin_ref: string;
  content_hash: string;
  content_blob_ref: string;
  created_at: string;
  updated_at: string;
}

function parseClaudeConfig(raw: string): ClaudeLayerConfig | undefined {
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

function mergeClaudeConfig(
  base: ClaudeLayerConfig | undefined,
  next: ClaudeLayerConfig | undefined,
): ClaudeLayerConfig | undefined {
  if (!base && !next) return undefined;
  const marketplaces = {
    ...(base?.marketplaces ?? {}),
    ...(next?.marketplaces ?? {}),
  };
  const pluginMap = new Map(
    [...(base?.plugins ?? []), ...(next?.plugins ?? [])].map((p) => [p.id, p]),
  );
  const plugins = [...pluginMap.values()];
  return {
    ...(Object.keys(marketplaces).length > 0 ? { marketplaces } : {}),
    ...(plugins.length > 0 ? { plugins } : {}),
  };
}

function tableExists(db: SqliteDatabase, name: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name),
  );
}

function loadPluginResources(
  db: SqliteDatabase,
  pluginId: string,
): ResourceRow[] {
  if (!tableExists(db, "plugin_resources")) {
    return [];
  }
  return db
    .prepare(
      `SELECT r.*
       FROM resources r
       JOIN plugin_resources pr ON pr.resource_id = r.id
       WHERE pr.layer_id = ?
       ORDER BY pr."order"`,
    )
    .all(pluginId) as ResourceRow[];
}

function mergePluginRows(
  db: SqliteDatabase,
  pluginIds: string[],
): {
  tags: string[];
  claude_config: string;
  needs_config: string;
  materialResources: ResourceRow[];
  compositionResources: ResourceRow[];
} {
  const tagSet = new Set<string>();
  let claude: ClaudeLayerConfig | undefined;
  const needsSet = new Set<string>();
  const materialOrder: string[] = [];
  const materialByKey = new Map<string, ResourceRow>();
  const compositionById = new Map<string, ResourceRow>();

  if (!tableExists(db, "plugins")) {
    return {
      tags: [],
      claude_config: "{}",
      needs_config: "[]",
      materialResources: [],
      compositionResources: [],
    };
  }

  for (const pluginId of pluginIds) {
    const plugin = db
      .prepare("SELECT * FROM plugins WHERE id = ?")
      .get(pluginId) as PluginRow | undefined;
    if (!plugin) continue;

    for (const tag of JSON.parse(plugin.tags) as string[]) {
      tagSet.add(tag);
    }
    for (const need of JSON.parse(plugin.needs_config) as string[]) {
      if (need) needsSet.add(need);
    }
    claude = mergeClaudeConfig(claude, parseClaudeConfig(plugin.claude_config));

    for (const resource of loadPluginResources(db, pluginId)) {
      if (resource.type === "plugin" || resource.type === "layer") {
        compositionById.set(resource.id, resource);
        continue;
      }
      const key = `${resource.type}:${resource.name}`;
      if (!materialByKey.has(key)) {
        materialOrder.push(key);
      }
      materialByKey.set(key, resource);
    }
  }

  return {
    tags: [...tagSet],
    claude_config: JSON.stringify(claude ?? {}),
    needs_config: JSON.stringify([...needsSet]),
    materialResources: materialOrder
      .map((key) => materialByKey.get(key))
      .filter((row): row is ResourceRow => row !== undefined),
    compositionResources: [...compositionById.values()],
  };
}

function insertLayerRow(
  db: SqliteDatabase,
  input: {
    id: string;
    name: string;
    version: string;
    description: string;
    tags: string[];
    claude_config: string;
    needs_config: string;
    default_environment_id: string | null;
    created_at: string;
    updated_at: string;
  },
): void {
  db.prepare(
    `INSERT INTO layers_new (
      id, name, version, org_slug, catalog_slug, description, tags,
      claude_config, needs_config, default_environment_id, created_at, updated_at
    ) VALUES (?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.name,
    input.version,
    input.description,
    JSON.stringify(input.tags),
    input.claude_config,
    input.needs_config,
    input.default_environment_id,
    input.created_at,
    input.updated_at,
  );
}

function copyResourcesToLayerNew(
  db: SqliteDatabase,
  layerId: string,
  resources: ResourceRow[],
): void {
  let order = 0;
  for (const resource of resources) {
    db.prepare(
      `INSERT OR IGNORE INTO layer_resources_new (layer_id, resource_id, "order")
       VALUES (?, ?, ?)`,
    ).run(layerId, resource.id, order);
    order += 1;
  }
}

/**
 * Migration 15: unify plugins + configured_layers into layers + layer_resources.
 */
export function migrateToUnifiedLayers(db: SqliteDatabase): void {
  const hasPlugins = tableExists(db, "plugins");
  const hasConfiguredLayers = tableExists(db, "configured_layers");
  if (!hasPlugins && !hasConfiguredLayers) return;

  db.exec(`
    CREATE TABLE layers_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0.0',
      org_slug TEXT NOT NULL DEFAULT '',
      catalog_slug TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      claude_config TEXT NOT NULL DEFAULT '{}',
      needs_config TEXT NOT NULL DEFAULT '[]',
      default_environment_id TEXT REFERENCES environments(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(org_slug, catalog_slug, name, version)
    );

    CREATE TABLE layer_resources_new (
      layer_id TEXT NOT NULL REFERENCES layers_new(id) ON DELETE CASCADE,
      resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (layer_id, resource_id)
    );

    CREATE TABLE deck_layers (
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      layer_id TEXT NOT NULL REFERENCES layers_new(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (deck_id, layer_id)
    );

    CREATE TABLE project_layers (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      layer_id TEXT NOT NULL REFERENCES layers_new(id) ON DELETE CASCADE,
      platforms TEXT NOT NULL DEFAULT '[]',
      applied_at TEXT NOT NULL,
      PRIMARY KEY (project_id, layer_id)
    );
  `);

  const referencedPluginIds = new Set<string>();
  const configuredLayers = tableExists(db, "configured_layers")
    ? (db
        .prepare("SELECT * FROM configured_layers ORDER BY created_at")
        .all() as ConfiguredLayerRow[])
    : [];

  for (const configuredLayer of configuredLayers) {
    const pluginLinks = tableExists(db, "configured_layer_plugins")
      ? (db
          .prepare(
            `SELECT plugin_id, "order" as "order"
             FROM configured_layer_plugins
             WHERE configured_layer_id = ?
             ORDER BY "order"`,
          )
          .all(configuredLayer.id) as Array<{ plugin_id: string; order: number }>)
      : [];

    const pluginIds = pluginLinks.map((link) => link.plugin_id);
    for (const pluginId of pluginIds) {
      referencedPluginIds.add(pluginId);
    }

    if (pluginIds.length === 0) {
      insertLayerRow(db, {
        id: configuredLayer.id,
        name: configuredLayer.name,
        version: configuredLayer.version,
        description: configuredLayer.description,
        tags: [],
        claude_config: "{}",
        needs_config: "[]",
        default_environment_id: configuredLayer.default_environment_id,
        created_at: configuredLayer.created_at,
        updated_at: configuredLayer.updated_at,
      });
      continue;
    }

    if (pluginIds.length === 1 && tableExists(db, "plugins")) {
      const pluginId = pluginIds[0];
      if (!pluginId) continue;
      const plugin = db
        .prepare("SELECT * FROM plugins WHERE id = ?")
        .get(pluginId) as PluginRow | undefined;
      if (!plugin) continue;

      insertLayerRow(db, {
        id: configuredLayer.id,
        name: configuredLayer.name,
        version: configuredLayer.version,
        description: configuredLayer.description || plugin.description,
        tags: JSON.parse(plugin.tags) as string[],
        claude_config: plugin.claude_config,
        needs_config: plugin.needs_config,
        default_environment_id: configuredLayer.default_environment_id,
        created_at: configuredLayer.created_at,
        updated_at: configuredLayer.updated_at,
      });
      copyResourcesToLayerNew(db, configuredLayer.id, loadPluginResources(db, pluginId));
      continue;
    }

    const merged = mergePluginRows(db, pluginIds);
    insertLayerRow(db, {
      id: configuredLayer.id,
      name: configuredLayer.name,
      version: configuredLayer.version,
      description: configuredLayer.description,
      tags: merged.tags,
      claude_config: merged.claude_config,
      needs_config: merged.needs_config,
      default_environment_id: configuredLayer.default_environment_id,
      created_at: configuredLayer.created_at,
      updated_at: configuredLayer.updated_at,
    });
    copyResourcesToLayerNew(db, configuredLayer.id, [
      ...merged.materialResources,
      ...merged.compositionResources,
    ]);
  }

  const orphanPlugins = hasPlugins
    ? (db
        .prepare("SELECT * FROM plugins ORDER BY created_at")
        .all() as PluginRow[])
    : [];

  for (const plugin of orphanPlugins) {
    if (referencedPluginIds.has(plugin.id)) continue;
    insertLayerRow(db, {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      tags: JSON.parse(plugin.tags) as string[],
      claude_config: plugin.claude_config,
      needs_config: plugin.needs_config,
      default_environment_id: null,
      created_at: plugin.created_at,
      updated_at: plugin.updated_at,
    });
    copyResourcesToLayerNew(db, plugin.id, loadPluginResources(db, plugin.id));
  }

  if (tableExists(db, "deck_configured_layers")) {
    const deckLinks = db
      .prepare(
        `SELECT deck_id, configured_layer_id, "order" as "order"
         FROM deck_configured_layers ORDER BY "order"`,
      )
      .all() as Array<{
        deck_id: string;
        configured_layer_id: string;
        order: number;
      }>;
    for (const link of deckLinks) {
      db.prepare(
        `INSERT OR IGNORE INTO deck_layers (deck_id, layer_id, "order")
         VALUES (?, ?, ?)`,
      ).run(link.deck_id, link.configured_layer_id, link.order);
    }
  }

  if (tableExists(db, "project_configured_layers")) {
    const projectLinks = db
      .prepare(
        `SELECT project_id, configured_layer_id, platforms, applied_at
         FROM project_configured_layers`,
      )
      .all() as Array<{
        project_id: string;
        configured_layer_id: string;
        platforms: string;
        applied_at: string;
      }>;
    for (const link of projectLinks) {
      db.prepare(
        `INSERT OR REPLACE INTO project_layers
         (project_id, layer_id, platforms, applied_at)
         VALUES (?, ?, ?, ?)`,
      ).run(
        link.project_id,
        link.configured_layer_id,
        link.platforms,
        link.applied_at,
      );
    }
  }

  db.exec(`
    DROP TABLE IF EXISTS deck_configured_layers;
    DROP TABLE IF EXISTS project_configured_layers;
    DROP TABLE IF EXISTS configured_layer_plugins;
    DROP TABLE IF EXISTS configured_layers;
    DROP TABLE IF EXISTS plugin_resources;
    DROP TABLE IF EXISTS plugin_dependencies;
    DROP TABLE IF EXISTS plugin_native_pins;
    DROP TABLE IF EXISTS plugins;

    ALTER TABLE layers_new RENAME TO layers;
    ALTER TABLE layer_resources_new RENAME TO layer_resources;
  `);

  rebuildUnifiedLayerChildForeignKeys(db);
}

function rebuildUnifiedLayerChildForeignKeys(db: SqliteDatabase): void {
  const rebuilds: Array<{ table: string; ddl: string }> = [
    {
      table: "layer_resources",
      ddl: `
        CREATE TABLE layer_resources_rebuilt (
          layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
          resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
          "order" INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (layer_id, resource_id)
        );
        INSERT INTO layer_resources_rebuilt SELECT * FROM layer_resources;
        DROP TABLE layer_resources;
        ALTER TABLE layer_resources_rebuilt RENAME TO layer_resources;
      `,
    },
    {
      table: "deck_layers",
      ddl: `
        CREATE TABLE deck_layers_rebuilt (
          deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
          layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
          "order" INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (deck_id, layer_id)
        );
        INSERT INTO deck_layers_rebuilt SELECT * FROM deck_layers;
        DROP TABLE deck_layers;
        ALTER TABLE deck_layers_rebuilt RENAME TO deck_layers;
      `,
    },
    {
      table: "project_layers",
      ddl: `
        CREATE TABLE project_layers_rebuilt (
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
          platforms TEXT NOT NULL DEFAULT '[]',
          applied_at TEXT NOT NULL,
          PRIMARY KEY (project_id, layer_id)
        );
        INSERT INTO project_layers_rebuilt SELECT * FROM project_layers;
        DROP TABLE project_layers;
        ALTER TABLE project_layers_rebuilt RENAME TO project_layers;
      `,
    },
  ];

  for (const { table, ddl } of rebuilds) {
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    if (exists) {
      db.exec(ddl);
    }
  }
}
