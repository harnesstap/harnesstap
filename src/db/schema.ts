import type { SqliteDatabase } from "./types.js";
import { migrateToUnifiedLayers } from "./migrate-to-unified-layers.js";
import { hashResourceBody } from "../services/resource-hash.js";
import type { ResourceMetadata, ResourceType } from "../types.js";

const SCHEMA_VERSION = 16;
const LEGACY_LOCAL_ID_PREFIX = "legacy-local:";

const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE IF NOT EXISTS resources (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL CHECK(type IN (
        'instruction','skill','rule','mcp_server','permission',
        'hook','agent','command','env_var','model_config'
      )),
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      content     TEXT NOT NULL DEFAULT '',
      metadata    TEXT NOT NULL DEFAULT '{}',
      source      TEXT NOT NULL DEFAULT 'manual',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(type);
    CREATE INDEX IF NOT EXISTS idx_resources_name ON resources(name);

    CREATE TABLE IF NOT EXISTS layers (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      tags        TEXT NOT NULL DEFAULT '[]',

      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS layer_resources (
      layer_id   TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
      resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      "order"     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (layer_id, resource_id)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      git_origin  TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL DEFAULT '',
      local_path  TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_layers (
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      layer_id   TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
      platforms   TEXT NOT NULL DEFAULT '[]',
      applied_at  TEXT NOT NULL,
      PRIMARY KEY (project_id, layer_id)
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      label       TEXT NOT NULL DEFAULT '',
      state       TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_project ON snapshots(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    );

    INSERT INTO schema_version (version) VALUES (1);
  `,

  2: `
    CREATE TABLE IF NOT EXISTS harness_preferences (
      scope            TEXT PRIMARY KEY DEFAULT 'default',
      main_harness     TEXT NOT NULL,
      alias_harnesses  TEXT NOT NULL DEFAULT '[]',
      updated_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_harnesses (
      project_id              TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      main_harness            TEXT NOT NULL,
      alias_harnesses         TEXT NOT NULL DEFAULT '[]',
      materialization_strategy TEXT NOT NULL DEFAULT 'symlink-preferred',
      updated_at              TEXT NOT NULL
    );
  `,

  3: `
    ALTER TABLE layers ADD COLUMN claude_config TEXT NOT NULL DEFAULT '{}';
  `,

  4: `
    CREATE TABLE IF NOT EXISTS project_plugin_state (
      project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      harness      TEXT NOT NULL DEFAULT 'claude-code',
      scanned_at   TEXT NOT NULL,
      committed    TEXT NOT NULL DEFAULT '[]',
      effective    TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (project_id, harness)
    );

    CREATE TABLE IF NOT EXISTS layer_plugins (
      layer_id            TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
      ref                  TEXT NOT NULL,
      version_constraint   TEXT NOT NULL,
      "order"              INTEGER NOT NULL DEFAULT 0,
      embed_on_export      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (layer_id, ref)
    );
  `,

  5: `
    CREATE TABLE layers_new (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      version     TEXT NOT NULL DEFAULT '1.0.0',
      description TEXT NOT NULL DEFAULT '',
      tags        TEXT NOT NULL DEFAULT '[]',
      claude_config TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      UNIQUE(name, version)
    );

    INSERT INTO layers_new (id, name, version, description, tags, claude_config, created_at, updated_at)
      SELECT id, name, '1.0.0', description, tags, claude_config, created_at, updated_at FROM layers;

    DROP TABLE layers;

    ALTER TABLE layers_new RENAME TO layers;

    CREATE TABLE IF NOT EXISTS layer_dependencies (
      layer_id           TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
      dependency_name     TEXT NOT NULL,
      version_constraint  TEXT NOT NULL,
      "order"             INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (layer_id, dependency_name)
    );
  `,

  6: `
    ALTER TABLE layers ADD COLUMN source_path TEXT NOT NULL DEFAULT '';
    ALTER TABLE layers ADD COLUMN source_hash TEXT NOT NULL DEFAULT '';
    ALTER TABLE layers ADD COLUMN source_present INTEGER NOT NULL DEFAULT 1;

    CREATE TABLE projects_new (
      id          TEXT PRIMARY KEY,
      git_origin  TEXT NOT NULL DEFAULT '',
      local_id    TEXT NOT NULL DEFAULT '',
      name        TEXT NOT NULL DEFAULT '',
      local_path  TEXT NOT NULL DEFAULT '',
      tracked_at  TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      CHECK (git_origin != '' OR local_id != '')
    );

    INSERT INTO projects_new (id, git_origin, local_id, name, local_path, tracked_at, created_at)
      SELECT id,
             git_origin,
             CASE
               WHEN git_origin = '' THEN '${LEGACY_LOCAL_ID_PREFIX}' || id
               ELSE ''
             END,
             name,
             local_path,
             created_at,
             created_at
        FROM projects;

    DROP TABLE projects;

    ALTER TABLE projects_new RENAME TO projects;

    CREATE UNIQUE INDEX idx_projects_git_origin ON projects(git_origin) WHERE git_origin != '';
    CREATE UNIQUE INDEX idx_projects_local_id ON projects(local_id) WHERE local_id != '';
  `,

  9: `
    ALTER TABLE plugins ADD COLUMN needs_config TEXT NOT NULL DEFAULT '[]';
  `,

  10: `
    CREATE TABLE environments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name)
    );

    CREATE TABLE environment_resources (
      environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
      resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (environment_id, resource_id)
    );

    CREATE TABLE environment_secret_refs (
      environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('keychain','env','file')),
      ref TEXT NOT NULL,
      PRIMARY KEY (environment_id, key)
    );
  `,

  12: `
    CREATE TABLE decks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL DEFAULT '',
      active_environment_id TEXT REFERENCES environments(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name)
    );

    CREATE TABLE deck_configured_layers (
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      configured_layer_id TEXT NOT NULL REFERENCES configured_layers(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (deck_id, configured_layer_id)
    );
  `,

  13: `
    ALTER TABLE resources ADD COLUMN namespace TEXT NOT NULL DEFAULT '';
    ALTER TABLE resources ADD COLUMN origin_kind TEXT NOT NULL DEFAULT 'manual'
      CHECK(origin_kind IN ('local_snapshot','marketplace_link','manual'));
    ALTER TABLE resources ADD COLUMN origin_ref TEXT NOT NULL DEFAULT '';
    ALTER TABLE resources ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
    ALTER TABLE resources ADD COLUMN content_blob_ref TEXT NOT NULL DEFAULT '';
  `,

  14: `
    CREATE TABLE resources_new (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL CHECK(type IN (
        'instruction','skill','rule','mcp_server','permission',
        'hook','agent','command','env_var','model_config',
        'plugin','layer'
      )),
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      content     TEXT NOT NULL DEFAULT '',
      metadata    TEXT NOT NULL DEFAULT '{}',
      source      TEXT NOT NULL DEFAULT 'manual',
      namespace   TEXT NOT NULL DEFAULT '',
      origin_kind TEXT NOT NULL DEFAULT 'manual'
        CHECK(origin_kind IN ('local_snapshot','marketplace_link','manual')),
      origin_ref  TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      content_blob_ref TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    INSERT INTO resources_new (
      id, type, name, description, content, metadata, source,
      namespace, origin_kind, origin_ref, content_hash, content_blob_ref,
      created_at, updated_at
    )
    SELECT
      id, type, name, description, content, metadata, source,
      namespace, origin_kind, origin_ref, content_hash, content_blob_ref,
      created_at, updated_at
    FROM resources;

    DROP TABLE resources;
    ALTER TABLE resources_new RENAME TO resources;

    CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(type);
    CREATE INDEX IF NOT EXISTS idx_resources_name ON resources(name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_type_name_namespace
      ON resources(type, name, namespace);
  `,

  11: `
    CREATE TABLE configured_layers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0.0',
      description TEXT NOT NULL DEFAULT '',
      default_environment_id TEXT REFERENCES environments(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name, version)
    );

    CREATE TABLE configured_layer_plugins (
      configured_layer_id TEXT NOT NULL REFERENCES configured_layers(id) ON DELETE CASCADE,
      plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (configured_layer_id, plugin_id)
    );

    CREATE TABLE project_configured_layers (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      configured_layer_id TEXT NOT NULL REFERENCES configured_layers(id) ON DELETE CASCADE,
      platforms TEXT NOT NULL DEFAULT '[]',
      applied_at TEXT NOT NULL,
      PRIMARY KEY (project_id, configured_layer_id)
    );
  `,

  7: `
    CREATE TABLE IF NOT EXISTS imported_snapshots (
      id              TEXT PRIMARY KEY,
      source_kind     TEXT NOT NULL CHECK(source_kind IN ('cursor-plugin', 'claude-plugin', 'marketplace')),
      source_label    TEXT NOT NULL,
      plugin_name     TEXT NOT NULL,
      plugin_version  TEXT,
      resource_ids    TEXT NOT NULL DEFAULT '[]',
      metadata        TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_imported_snapshots_created_at
      ON imported_snapshots(created_at DESC);

    CREATE TABLE IF NOT EXISTS imported_snapshot_installs (
      snapshot_id    TEXT NOT NULL REFERENCES imported_snapshots(id) ON DELETE CASCADE,
      platform_id    TEXT NOT NULL,
      files          TEXT NOT NULL DEFAULT '[]',
      installed_at   TEXT NOT NULL,
      PRIMARY KEY (snapshot_id, platform_id)
    );

    CREATE INDEX IF NOT EXISTS idx_imported_snapshot_installs_installed_at
      ON imported_snapshot_installs(installed_at DESC);
  `,

};

function applyMigration16(db: SqliteDatabase): void {
  const hasProjectHarnesses = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_harnesses'",
    )
    .get();
  if (!hasProjectHarnesses) return;

  const columns = db
    .prepare("PRAGMA table_info(project_harnesses)")
    .all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "cursor_skill_mode")) {
    db.exec("ALTER TABLE project_harnesses ADD COLUMN cursor_skill_mode TEXT");
  }
}

function ensurePluginsTableRenamed(db: SqliteDatabase): void {
  const hasPlugins = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plugins'")
    .get();
  if (!hasPlugins) {
    applyMigration8(db);
  }
}

/** Migration 8: layers → plugins (design-time component bundle). */
function applyMigration8(db: SqliteDatabase): void {
  // project_layers.layer_id still references plugin id until configured layers (migration 11).
  const renames: Array<[string, string]> = [
    ["layers", "plugins"],
    ["layer_resources", "plugin_resources"],
    ["layer_dependencies", "plugin_dependencies"],
    ["layer_plugins", "plugin_native_pins"],
  ];
  for (const [from, to] of renames) {
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(from);
    if (exists) {
      db.exec(`ALTER TABLE ${from} RENAME TO ${to}`);
    }
  }

  // Bun/SQLite may leave child FKs pointing at the old `layers` name after RENAME.
  rebuildPluginChildForeignKeys(db);
}

function rebuildPluginChildForeignKeys(db: SqliteDatabase): void {
  const hasPlugins = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plugins'")
    .get();
  if (!hasPlugins) return;

  const rebuilds: Array<{ table: string; ddl: string }> = [
    {
      table: "plugin_resources",
      ddl: `
        CREATE TABLE plugin_resources_new (
          layer_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
          resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
          "order" INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (layer_id, resource_id)
        );
        INSERT INTO plugin_resources_new SELECT * FROM plugin_resources;
        DROP TABLE plugin_resources;
        ALTER TABLE plugin_resources_new RENAME TO plugin_resources;
      `,
    },
    {
      table: "plugin_dependencies",
      ddl: `
        CREATE TABLE plugin_dependencies_new (
          layer_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
          dependency_name TEXT NOT NULL,
          version_constraint TEXT NOT NULL,
          "order" INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (layer_id, dependency_name)
        );
        INSERT INTO plugin_dependencies_new SELECT * FROM plugin_dependencies;
        DROP TABLE plugin_dependencies;
        ALTER TABLE plugin_dependencies_new RENAME TO plugin_dependencies;
      `,
    },
    {
      table: "plugin_native_pins",
      ddl: `
        CREATE TABLE plugin_native_pins_new (
          layer_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
          ref TEXT NOT NULL,
          version_constraint TEXT NOT NULL,
          "order" INTEGER NOT NULL DEFAULT 0,
          embed_on_export INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (layer_id, ref)
        );
        INSERT INTO plugin_native_pins_new SELECT * FROM plugin_native_pins;
        DROP TABLE plugin_native_pins;
        ALTER TABLE plugin_native_pins_new RENAME TO plugin_native_pins;
      `,
    },
    {
      table: "project_layers",
      ddl: `
        CREATE TABLE project_layers_new (
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          layer_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
          platforms TEXT NOT NULL DEFAULT '[]',
          applied_at TEXT NOT NULL,
          PRIMARY KEY (project_id, layer_id)
        );
        INSERT INTO project_layers_new SELECT * FROM project_layers;
        DROP TABLE project_layers;
        ALTER TABLE project_layers_new RENAME TO project_layers;
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

/** Migration 11: configured layers; repoint project attachment from project_layers. */
function applyMigration11(db: SqliteDatabase): void {
  const migration = MIGRATIONS[11];
  if (migration) {
    db.exec(migration);
  }

  const hasProjectLayers = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_layers'")
    .get();
  if (!hasProjectLayers) return;

  const pluginToConfiguredLayer = new Map<string, string>();
  const projectLayers = db
    .prepare("SELECT project_id, layer_id, platforms, applied_at FROM project_layers")
    .all() as Array<{
      project_id: string;
      layer_id: string;
      platforms: string;
      applied_at: string;
    }>;

  for (const row of projectLayers) {
    if (!pluginToConfiguredLayer.has(row.layer_id)) {
      const plugin = db
        .prepare("SELECT id, name, version, description, created_at, updated_at FROM plugins WHERE id = ?")
        .get(row.layer_id) as
        | {
            id: string;
            name: string;
            version: string;
            description: string;
            created_at: string;
            updated_at: string;
          }
        | undefined;
      if (!plugin) continue;

      const configuredLayerId = `legacy-wrap:${plugin.id}`;
      db.prepare(
        `INSERT OR IGNORE INTO configured_layers
         (id, name, version, description, default_environment_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      ).run(
        configuredLayerId,
        plugin.name,
        plugin.version,
        plugin.description,
        plugin.created_at,
        plugin.updated_at,
      );
      db.prepare(
        `INSERT OR IGNORE INTO configured_layer_plugins
         (configured_layer_id, plugin_id, "order")
         VALUES (?, ?, 0)`,
      ).run(configuredLayerId, plugin.id);
      pluginToConfiguredLayer.set(row.layer_id, configuredLayerId);
    }
  }

  for (const row of projectLayers) {
    const configuredLayerId = pluginToConfiguredLayer.get(row.layer_id);
    if (!configuredLayerId) continue;
    db.prepare(
      `INSERT OR REPLACE INTO project_configured_layers
       (project_id, configured_layer_id, platforms, applied_at)
       VALUES (?, ?, ?, ?)`,
    ).run(row.project_id, configuredLayerId, row.platforms, row.applied_at);
  }

  db.exec("DROP TABLE project_layers");
}

function parsePluginRefForMigration(ref: string): {
  name: string;
  namespace: string;
  origin_ref: string;
} {
  const trimmed = ref.trim();
  if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
    const name = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
    return { name, namespace: "", origin_ref: trimmed };
  }
  const at = trimmed.lastIndexOf("@");
  if (at === -1) {
    return { name: trimmed, namespace: "", origin_ref: trimmed };
  }
  return {
    name: trimmed.slice(0, at),
    namespace: trimmed.slice(at + 1),
    origin_ref: trimmed,
  };
}

function migrationPluginMetadata(
  versionConstraint: string,
  embedOnExport: number,
): string {
  const metadata: Record<string, unknown> = {
    source_kind: "marketplace",
    sync_status: "never_synced",
    portable: embedOnExport !== 0 ? "embed" : "reference",
  };
  if (
    versionConstraint &&
    versionConstraint !== "latest" &&
    versionConstraint !== "*"
  ) {
    metadata.version_constraint = versionConstraint;
  }
  return JSON.stringify(metadata);
}

function migrationLayerMetadata(versionConstraint: string): string {
  const metadata: Record<string, unknown> = {};
  if (
    versionConstraint &&
    versionConstraint !== "latest" &&
    versionConstraint !== "*"
  ) {
    metadata.version_constraint = versionConstraint;
  }
  return JSON.stringify(metadata);
}

function ensureCompositionResourceOnMigration(
  db: SqliteDatabase,
  input: {
    type: "plugin" | "layer";
    name: string;
    namespace: string;
    origin_ref: string;
    metadata: string;
    now: string;
  },
): string {
  const existing = db
    .prepare(
      "SELECT id FROM resources WHERE type = ? AND name = ? AND namespace = ?",
    )
    .get(input.type, input.name, input.namespace) as { id: string } | undefined;
  if (existing) {
    return existing.id;
  }

  const id = `migrate:${input.type}:${input.name}:${input.namespace}`;
  const contentHash = hashResourceBody({
    type: input.type,
    content: "{}",
    metadata: JSON.parse(input.metadata) as ResourceMetadata,
  });

  db.prepare(
    `INSERT INTO resources (
      id, type, name, description, content, metadata, source,
      namespace, origin_kind, origin_ref, content_hash, content_blob_ref,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.type,
    input.name,
    input.type === "plugin"
      ? `Plugin reference: ${input.origin_ref}`
      : `Layer reference: ${input.name}`,
    "{}",
    input.metadata,
    `migration:${input.type}`,
    input.namespace,
    input.type === "plugin" && input.namespace ? "marketplace_link" : "manual",
    input.origin_ref,
    contentHash,
    "",
    input.now,
    input.now,
  );

  return id;
}

/** Migration 14: composition resources; migrate pins/deps; drop legacy tables. */
function applyMigration14(db: SqliteDatabase): void {
  const hasResources = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'resources'")
    .get();
  const migration = MIGRATIONS[14];
  if (migration && hasResources) {
    db.exec(migration);
  } else if (!hasResources) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS resources (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL CHECK(type IN (
          'instruction','skill','rule','mcp_server','permission',
          'hook','agent','command','env_var','model_config',
          'plugin','layer'
        )),
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        content     TEXT NOT NULL DEFAULT '',
        metadata    TEXT NOT NULL DEFAULT '{}',
        source      TEXT NOT NULL DEFAULT 'manual',
        namespace   TEXT NOT NULL DEFAULT '',
        origin_kind TEXT NOT NULL DEFAULT 'manual'
          CHECK(origin_kind IN ('local_snapshot','marketplace_link','manual')),
        origin_ref  TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        content_blob_ref TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(type);
      CREATE INDEX IF NOT EXISTS idx_resources_name ON resources(name);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_type_name_namespace
        ON resources(type, name, namespace);
    `);
  }

  const now = new Date().toISOString();

  const hasNativePins = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plugin_native_pins'",
    )
    .get();
  if (hasNativePins) {
    const pins = db
      .prepare(
        `SELECT layer_id, ref, version_constraint, "order", embed_on_export
         FROM plugin_native_pins ORDER BY "order"`,
      )
      .all() as Array<{
        layer_id: string;
        ref: string;
        version_constraint: string;
        order: number;
        embed_on_export: number;
      }>;

    for (const pin of pins) {
      const identity = parsePluginRefForMigration(pin.ref);
      const resourceId = ensureCompositionResourceOnMigration(db, {
        type: "plugin",
        name: identity.name,
        namespace: identity.namespace,
        origin_ref: identity.origin_ref,
        metadata: migrationPluginMetadata(
          pin.version_constraint,
          pin.embed_on_export,
        ),
        now,
      });

      db.prepare(
        `INSERT OR IGNORE INTO plugin_resources (layer_id, resource_id, "order")
         VALUES (?, ?, ?)`,
      ).run(pin.layer_id, resourceId, pin.order);
    }

    db.exec("DROP TABLE plugin_native_pins");
  }

  const hasDependencies = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plugin_dependencies'",
    )
    .get();
  if (hasDependencies) {
    const deps = db
      .prepare(
        `SELECT layer_id, dependency_name, version_constraint, "order"
         FROM plugin_dependencies ORDER BY "order"`,
      )
      .all() as Array<{
        layer_id: string;
        dependency_name: string;
        version_constraint: string;
        order: number;
      }>;

    for (const dep of deps) {
      const constraint =
        dep.version_constraint === "latest" || dep.version_constraint === "*"
          ? ""
          : dep.version_constraint;
      const resourceId = ensureCompositionResourceOnMigration(db, {
        type: "layer",
        name: dep.dependency_name,
        namespace: constraint,
        origin_ref: dep.dependency_name,
        metadata: migrationLayerMetadata(dep.version_constraint),
        now,
      });

      db.prepare(
        `INSERT OR IGNORE INTO plugin_resources (layer_id, resource_id, "order")
         VALUES (?, ?, ?)`,
      ).run(dep.layer_id, resourceId, dep.order);
    }

    db.exec("DROP TABLE plugin_dependencies");
  }

  db.exec("DROP TABLE IF EXISTS project_plugin_state");
}

/** Migration 13: resource identity columns, dedup, hash backfill, unique index. */
function applyMigration13(db: SqliteDatabase): void {
  const hasResources = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'resources'")
    .get();
  if (!hasResources) return;

  const migration = MIGRATIONS[13];
  if (migration) {
    db.exec(migration);
  }

  const duplicateGroups = db
    .prepare(
      `SELECT type, name, COUNT(*) AS cnt
       FROM resources
       WHERE namespace = ''
       GROUP BY type, name
       HAVING cnt > 1`,
    )
    .all() as Array<{ type: string; name: string; cnt: number }>;

  for (const group of duplicateGroups) {
    const rows = db
      .prepare(
        `SELECT id, updated_at
         FROM resources
         WHERE type = ? AND name = ? AND namespace = ''
         ORDER BY updated_at DESC`,
      )
      .all(group.type, group.name) as Array<{ id: string; updated_at: string }>;

    const [winner, ...losers] = rows;
    if (!winner) continue;

    for (const loser of losers) {
      rewriteResourceForeignKeys(db, winner.id, loser.id);
      db.prepare("DELETE FROM resources WHERE id = ?").run(loser.id);
    }
  }

  const resourcesNeedingHash = db
    .prepare(
      `SELECT id, type, content, metadata
       FROM resources
       WHERE content_hash = ''`,
    )
    .all() as Array<{
      id: string;
      type: string;
      content: string;
      metadata: string;
    }>;

  for (const row of resourcesNeedingHash) {
    const metadata = JSON.parse(row.metadata) as ResourceMetadata;
    const contentHash = hashResourceBody({
      type: row.type as ResourceType,
      content: row.content,
      metadata,
    });
    db.prepare("UPDATE resources SET content_hash = ? WHERE id = ?").run(
      contentHash,
      row.id,
    );
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_type_name_namespace
      ON resources(type, name, namespace);
  `);
}

function rewriteResourceForeignKeys(
  db: SqliteDatabase,
  winnerId: string,
  loserId: string,
): void {
  const layerResourceTable = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('layer_resources', 'plugin_resources')",
    )
    .all() as Array<{ name: string }>;
  const layerResourceName = layerResourceTable.some((t) => t.name === "layer_resources")
    ? "layer_resources"
    : layerResourceTable.some((t) => t.name === "plugin_resources")
      ? "plugin_resources"
      : null;
  if (layerResourceName) {
    const layerIdColumn = layerResourceName === "plugin_resources" ? "layer_id" : "layer_id";
    const layerLinks = db
      .prepare(`SELECT ${layerIdColumn} as layer_id FROM ${layerResourceName} WHERE resource_id = ?`)
      .all(loserId) as Array<{ layer_id: string }>;

    for (const link of layerLinks) {
      const winnerLinked = db
        .prepare(
          `SELECT 1 FROM ${layerResourceName} WHERE ${layerIdColumn} = ? AND resource_id = ?`,
        )
        .get(link.layer_id, winnerId);

      if (winnerLinked) {
        db.prepare(
          `DELETE FROM ${layerResourceName} WHERE ${layerIdColumn} = ? AND resource_id = ?`,
        ).run(link.layer_id, loserId);
      } else {
        db.prepare(
          `UPDATE ${layerResourceName} SET resource_id = ? WHERE ${layerIdColumn} = ? AND resource_id = ?`,
        ).run(winnerId, link.layer_id, loserId);
      }
    }
  }

  const hasEnvironmentResources = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'environment_resources'")
    .get();
  if (hasEnvironmentResources) {
    const environmentLinks = db
      .prepare("SELECT environment_id FROM environment_resources WHERE resource_id = ?")
      .all(loserId) as Array<{ environment_id: string }>;

    for (const link of environmentLinks) {
      const winnerLinked = db
        .prepare(
          "SELECT 1 FROM environment_resources WHERE environment_id = ? AND resource_id = ?",
        )
        .get(link.environment_id, winnerId);

      if (winnerLinked) {
        db.prepare(
          "DELETE FROM environment_resources WHERE environment_id = ? AND resource_id = ?",
        ).run(link.environment_id, loserId);
      } else {
        db.prepare(
          "UPDATE environment_resources SET resource_id = ? WHERE environment_id = ? AND resource_id = ?",
        ).run(winnerId, link.environment_id, loserId);
      }
    }
  }
}

export function initializeSchema(db: SqliteDatabase): void {
  const currentVersion = getSchemaVersion(db);

  if (currentVersion >= SCHEMA_VERSION) return;

  // Migrations 5 and 6 rebuild parent tables using the rename trick (CREATE new,
  // copy, DROP old, RENAME). SQLite fires ON DELETE CASCADE on child tables even
  // for DROP TABLE when foreign_keys=ON, so we must toggle it outside the
  // transaction and restore it afterward.
  const needsFkToggle =
    currentVersion < 5 ||
    currentVersion < 6 ||
    currentVersion < 8 ||
    currentVersion < 11 ||
    currentVersion < 14 ||
    currentVersion < 15;
  if (needsFkToggle) {
    db.exec("PRAGMA foreign_keys = OFF");
  }

  try {
    db.transaction(() => {
      for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
        if (v === 8) {
          applyMigration8(db);
          continue;
        }
        if (v >= 9 && v < 15) {
          ensurePluginsTableRenamed(db);
        }
        if (v === 11) {
          applyMigration11(db);
          continue;
        }
        if (v === 13) {
          applyMigration13(db);
          continue;
        }
        if (v === 14) {
          applyMigration14(db);
          continue;
        }
        if (v === 15) {
          migrateToUnifiedLayers(db);
          continue;
        }
        if (v === 16) {
          applyMigration16(db);
          continue;
        }
        const migration = MIGRATIONS[v];
        if (migration) {
          db.exec(migration);
        }
      }

      const hasVersionRow = db
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number } | undefined;

      if (hasVersionRow) {
        db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
      } else {
        db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
          SCHEMA_VERSION,
        );
      }
    })();
  } finally {
    if (needsFkToggle) {
      db.exec("PRAGMA foreign_keys = ON");
    }
  }
}

function getSchemaVersion(db: SqliteDatabase): number {
  try {
    const row = db
      .prepare("SELECT version FROM schema_version LIMIT 1")
      .get() as { version: number } | undefined;
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}
