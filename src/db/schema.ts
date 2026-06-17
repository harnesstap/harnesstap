import type { SqliteDatabase } from "./types.js";

const SCHEMA_VERSION = 19;

const MIGRATIONS: Record<number, string> = {
  19: `
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

    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL DEFAULT '',
      active_environment_id TEXT REFERENCES environments(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name)
    );

    CREATE TABLE IF NOT EXISTS deck_layers (
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (deck_id, layer_id)
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

    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    );

    INSERT INTO schema_version (version) VALUES (19);
  `,
};

export interface InitializeSchemaOptions {
  /** Allow opening a pre-v19 database for read-only export (migrate export). */
  allowLegacyRead?: boolean;
}

export function initializeSchema(
  db: SqliteDatabase,
  options: InitializeSchemaOptions = {},
): void {
  const currentVersion = getSchemaVersion(db);

  if (currentVersion >= SCHEMA_VERSION) return;

  if (currentVersion > 0) {
    if (options.allowLegacyRead) {
      return;
    }
    throw new Error(
      `Database schema v${currentVersion} cannot be upgraded in place. ` +
        "Export with `hd migrate export backup.tar`, remove the old database, " +
        "then `hd migrate import backup.tar`.",
    );
  }

  db.transaction(() => {
    const migration = MIGRATIONS[SCHEMA_VERSION];
    if (migration) {
      db.exec(migration);
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
