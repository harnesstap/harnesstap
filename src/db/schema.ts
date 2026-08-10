import type { SqliteDatabase } from "./types.js";

const SCHEMA_VERSION = 24;

const MIGRATIONS: Record<number, string> = {
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
};

export interface InitializeSchemaOptions {
  /** Allow opening a pre-v20 database for read-only export (migrate export). */
  allowLegacyRead?: boolean;
}

export function initializeSchema(
  db: SqliteDatabase,
  options: InitializeSchemaOptions = {},
): void {
  const currentVersion = getSchemaVersion(db);

  if (currentVersion >= SCHEMA_VERSION) return;

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

  db.transaction(() => {
    if (currentVersion === 0) {
      const bootstrap = MIGRATIONS[22];
      if (bootstrap) {
        db.exec(bootstrap);
      }
    }

    const startVersion = currentVersion === 0 ? 23 : currentVersion + 1;
    for (let v = startVersion; v <= SCHEMA_VERSION; v++) {
      const migration = MIGRATIONS[v];
      if (migration) {
        db.exec(migration);
      }
      db.prepare("UPDATE schema_version SET version = ?").run(v);
    }
  })();
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
