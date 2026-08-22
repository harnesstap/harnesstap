import type { SqliteDatabase } from "./types.js";

const SCHEMA_VERSION = 29;

type Migration = string | ((db: SqliteDatabase) => void);

const MIGRATIONS: Record<number, Migration> = {
  22: `
    CREATE TABLE IF NOT EXISTS resources (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL CHECK(type IN (
        'instruction','skill','rule','mcp_server','permission',
        'hook','agent','command','env_var','model_config',
        'plugin_pin','layer'
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

    CREATE TABLE IF NOT EXISTS environments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name)
    );

    CREATE TABLE IF NOT EXISTS layers (
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

    CREATE TABLE IF NOT EXISTS layer_resources (
      layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
      resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (layer_id, resource_id)
    );

    CREATE TABLE IF NOT EXISTS layer_publish_targets (
      layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
      org_slug TEXT NOT NULL,
      catalog_slug TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (layer_id, org_slug, catalog_slug)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      git_origin  TEXT NOT NULL DEFAULT '',
      local_id    TEXT NOT NULL DEFAULT '',
      name        TEXT NOT NULL DEFAULT '',
      local_path  TEXT NOT NULL DEFAULT '',
      tracked_at  TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      CHECK (git_origin != '' OR local_id != '')
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_git_origin
      ON projects(git_origin) WHERE git_origin != '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_local_id
      ON projects(local_id) WHERE local_id != '';

    CREATE TABLE IF NOT EXISTS project_layers (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
      platforms TEXT NOT NULL DEFAULT '[]',
      applied_at TEXT NOT NULL,
      PRIMARY KEY (project_id, layer_id)
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      label       TEXT NOT NULL DEFAULT '',
      state       TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_project
      ON snapshots(project_id, created_at DESC);

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
      updated_at              TEXT NOT NULL,
      cursor_skill_mode       TEXT
    );

    CREATE TABLE IF NOT EXISTS environment_resources (
      environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
      resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (environment_id, resource_id)
    );

    CREATE TABLE IF NOT EXISTS environment_secret_refs (
      environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('keychain','env','file')),
      ref TEXT NOT NULL,
      PRIMARY KEY (environment_id, key)
    );

    CREATE TABLE IF NOT EXISTS imported_snapshots (
      id              TEXT PRIMARY KEY,
      source_kind     TEXT NOT NULL CHECK(source_kind IN (
        'cursor-plugin', 'claude-plugin', 'codex-plugin', 'copilot-plugin',
        'marketplace', 'skill-package'
      )),
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

    CREATE TABLE IF NOT EXISTS global_apply_snapshots (
      id           TEXT PRIMARY KEY,
      profile_name TEXT NOT NULL,
      layer_ids    TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS global_apply_snapshot_installs (
      snapshot_id  TEXT NOT NULL REFERENCES global_apply_snapshots(id) ON DELETE CASCADE,
      platform_id  TEXT NOT NULL,
      files        TEXT NOT NULL DEFAULT '[]',
      installed_at TEXT NOT NULL,
      PRIMARY KEY (snapshot_id, platform_id)
    );

    CREATE INDEX IF NOT EXISTS idx_global_apply_snapshots_created_at
      ON global_apply_snapshots(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_global_apply_snapshot_installs_installed_at
      ON global_apply_snapshot_installs(installed_at DESC);

    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    );

    INSERT INTO schema_version (version) VALUES (22);
  `,
  23: `
    ALTER TABLE layers ADD COLUMN dirty INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE layers ADD COLUMN frozen_at TEXT;
    CREATE TABLE IF NOT EXISTS layer_working_snapshots (
      layer_id TEXT PRIMARY KEY REFERENCES layers(id) ON DELETE CASCADE,
      source_version TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `,
  24: `
    ALTER TABLE layers ADD COLUMN overrides TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE global_apply_snapshots ADD COLUMN resolved_set TEXT NOT NULL DEFAULT '[]';
  `,
  25: `
    ALTER TABLE layers ADD COLUMN origin TEXT NOT NULL DEFAULT 'authored'
      CHECK(origin IN ('authored','upstream','catalog'));
    UPDATE layers SET origin = 'catalog'
      WHERE org_slug != '' AND catalog_slug != '';
  `,
  26: migrateResourcesToPluginDependencyType,
  27: migrateLayerTablesToPluginTables,
  28: `
    ALTER TABLE plugins ADD COLUMN ap_name TEXT NOT NULL DEFAULT '';
  `,
  29: `
    ALTER TABLE plugins ADD COLUMN origin_locator TEXT NOT NULL DEFAULT '';
    ALTER TABLE plugins ADD COLUMN origin_fingerprint TEXT NOT NULL DEFAULT '';
    ALTER TABLE plugins ADD COLUMN origin_fingerprint_kind TEXT NOT NULL DEFAULT ''
      CHECK(origin_fingerprint_kind IN ('', 'git_sha', 'catalog_digest', 'catalog_version'));
  `,
};

function tableExists(db: SqliteDatabase, name: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    )
    .get(name) as { ok: number } | undefined;
  return row !== undefined;
}

/**
 * Rename layer storage tables/columns to plugin, rebuilding FK-bearing tables
 * so references point at plugins(id). SQLite ALTER TABLE RENAME leaves child
 * FK definitions pointing at the old parent name.
 *
 * Adaptation: FK pragma must be toggled outside the migration transaction
 * (same as v26); initializeSchema disables FKs for upgrades through v27.
 */
function migrateLayerTablesToPluginTables(db: SqliteDatabase): void {
  if (tableExists(db, "layers")) {
    db.exec(`ALTER TABLE layers RENAME TO plugins`);
  }

  if (tableExists(db, "layer_resources")) {
    db.exec(`
      CREATE TABLE plugin_resources (
        plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        "order" INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (plugin_id, resource_id)
      );
      INSERT INTO plugin_resources (plugin_id, resource_id, "order")
        SELECT layer_id, resource_id, "order" FROM layer_resources;
      DROP TABLE layer_resources;
    `);
  }

  if (tableExists(db, "layer_working_snapshots")) {
    db.exec(`
      CREATE TABLE plugin_working_snapshots (
        plugin_id TEXT PRIMARY KEY REFERENCES plugins(id) ON DELETE CASCADE,
        source_version TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO plugin_working_snapshots (plugin_id, source_version, payload, created_at)
        SELECT layer_id, source_version, payload, created_at FROM layer_working_snapshots;
      DROP TABLE layer_working_snapshots;
    `);
  }

  if (tableExists(db, "layer_publish_targets")) {
    db.exec(`
      CREATE TABLE plugin_publish_targets (
        plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        org_slug TEXT NOT NULL,
        catalog_slug TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (plugin_id, org_slug, catalog_slug)
      );
      INSERT INTO plugin_publish_targets (plugin_id, org_slug, catalog_slug, created_at)
        SELECT layer_id, org_slug, catalog_slug, created_at FROM layer_publish_targets;
      DROP TABLE layer_publish_targets;
    `);
  }

  if (tableExists(db, "project_layers")) {
    db.exec(`
      CREATE TABLE project_plugins (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        platforms TEXT NOT NULL DEFAULT '[]',
        applied_at TEXT NOT NULL,
        PRIMARY KEY (project_id, plugin_id)
      );
      INSERT INTO project_plugins (project_id, plugin_id, platforms, applied_at)
        SELECT project_id, layer_id, platforms, applied_at FROM project_layers;
      DROP TABLE project_layers;
    `);
  }

  if (tableExists(db, "global_apply_snapshots")) {
    const columns = db
      .prepare("PRAGMA table_info(global_apply_snapshots)")
      .all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === "layer_ids")) {
      db.exec(
        `ALTER TABLE global_apply_snapshots RENAME COLUMN layer_ids TO plugin_ids`,
      );
    }
  }
}

/**
 * Rebuild resources CHECK to accept `plugin` (not plugin_pin/layer), convert
 * existing composition rows, and de-dupe (type,name,namespace) collisions by
 * keeping the plugin_pin row and repointing layer_resources.
 *
 * Adaptation: FK pragma must be toggled outside the migration transaction
 * (SQLite ignores foreign_keys changes mid-transaction), so initializeSchema
 * disables FKs around the whole upgrade loop when running v26+.
 * Incomplete upgrade fixtures without a resources table are a no-op.
 */
function migrateResourcesToPluginDependencyType(db: SqliteDatabase): void {
  if (!tableExists(db, "resources")) {
    return;
  }

  if (tableExists(db, "layer_resources")) {
    // Drop layer attachments that would collide on PK after repointing to the pin.
    db.exec(`
      DELETE FROM layer_resources
      WHERE resource_id IN (
        SELECT l.id FROM resources l
        INNER JOIN resources p
          ON p.type = 'plugin_pin' AND l.type = 'layer'
         AND p.name = l.name AND p.namespace = l.namespace
      )
      AND EXISTS (
        SELECT 1
        FROM layer_resources lr_pin
        INNER JOIN resources p ON p.id = lr_pin.resource_id AND p.type = 'plugin_pin'
        INNER JOIN resources l ON l.id = layer_resources.resource_id AND l.type = 'layer'
        WHERE lr_pin.layer_id = layer_resources.layer_id
          AND p.name = l.name
          AND p.namespace = l.namespace
      );
    `);

    db.exec(`
      UPDATE layer_resources
      SET resource_id = (
        SELECT p.id FROM resources p
        INNER JOIN resources l ON l.id = layer_resources.resource_id
        WHERE p.type = 'plugin_pin' AND l.type = 'layer'
          AND p.name = l.name AND p.namespace = l.namespace
      )
      WHERE resource_id IN (
        SELECT l.id FROM resources l
        INNER JOIN resources p
          ON p.type = 'plugin_pin' AND l.type = 'layer'
         AND p.name = l.name AND p.namespace = l.namespace
      );
    `);
  }

  db.exec(`
    DELETE FROM resources
    WHERE type = 'layer'
      AND EXISTS (
        SELECT 1 FROM resources p
        WHERE p.type = 'plugin_pin'
          AND p.name = resources.name
          AND p.namespace = resources.namespace
      );
  `);

  db.exec(`
    CREATE TABLE resources_new (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL CHECK(type IN (
        'instruction','skill','rule','mcp_server','permission',
        'hook','agent','command','env_var','model_config','plugin'
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

    INSERT INTO resources_new
      SELECT
        id,
        CASE WHEN type IN ('plugin_pin','layer') THEN 'plugin' ELSE type END,
        name,
        description,
        content,
        CASE
          WHEN type = 'plugin_pin' THEN json_set(
            CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
            '$.source_kind',
            COALESCE(json_extract(metadata, '$.source_kind'), 'marketplace')
          )
          WHEN type = 'layer' THEN json_set(
            CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
            '$.source_kind', 'local'
          )
          ELSE metadata
        END,
        CASE WHEN type IN ('plugin_pin','layer') THEN 'composition:plugin' ELSE source END,
        namespace,
        origin_kind,
        CASE WHEN type = 'layer' AND origin_ref = '' THEN name ELSE origin_ref END,
        content_hash,
        content_blob_ref,
        created_at,
        updated_at
      FROM resources;

    DROP TABLE resources;
    ALTER TABLE resources_new RENAME TO resources;

    CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(type);
    CREATE INDEX IF NOT EXISTS idx_resources_name ON resources(name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_type_name_namespace
      ON resources(type, name, namespace);
  `);
}

export interface InitializeSchemaOptions {
  /** Allow opening a pre-v20 database for read-only export (migrate export). */
  allowLegacyRead?: boolean;
}

function runMigration(db: SqliteDatabase, migration: Migration): void {
  if (typeof migration === "function") {
    migration(db);
  } else {
    db.exec(migration);
  }
}

export function initializeSchema(
  db: SqliteDatabase,
  options: InitializeSchemaOptions = {},
): void {
  const currentVersion = getSchemaVersion(db);

  if (currentVersion > SCHEMA_VERSION) {
    throw new Error(
      `Database schema v${currentVersion} is newer than this binary (v${SCHEMA_VERSION}). ` +
        "Use a matching HarnessTap build, or point HARNESSTAP_HOME at a compatible database.",
    );
  }

  if (currentVersion === SCHEMA_VERSION) return;

  if (currentVersion > 0 && currentVersion < 22) {
    if (options.allowLegacyRead) {
      return;
    }
    throw new Error(
      `Database schema v${currentVersion} cannot be upgraded in place. ` +
        "Export with `ht migrate export backup.tar`, remove the old database, " +
        "then `ht migrate import backup.tar`.",
    );
  }

  // Table rebuilds (v26) and renames (v27) need FKs off; SQLite ignores FK
  // pragma changes inside a transaction.
  const needsFkOff = currentVersion < 27 && SCHEMA_VERSION >= 27;
  if (needsFkOff) {
    db.exec("PRAGMA foreign_keys = OFF");
  }
  try {
    db.transaction(() => {
      if (currentVersion === 0) {
        const bootstrap = MIGRATIONS[22];
        if (bootstrap) {
          runMigration(db, bootstrap);
        }
      }

      const startVersion = currentVersion === 0 ? 23 : currentVersion + 1;
      for (let v = startVersion; v <= SCHEMA_VERSION; v++) {
        const migration = MIGRATIONS[v];
        if (migration) {
          runMigration(db, migration);
        }
        db.prepare("UPDATE schema_version SET version = ?").run(v);
      }
    })();
  } finally {
    if (needsFkOff) {
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
