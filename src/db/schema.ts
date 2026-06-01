import type { SqliteDatabase } from "./types.js";

const SCHEMA_VERSION = 7;
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

export function initializeSchema(db: SqliteDatabase): void {
  const currentVersion = getSchemaVersion(db);

  if (currentVersion >= SCHEMA_VERSION) return;

  // Migrations 5 and 6 rebuild parent tables using the rename trick (CREATE new,
  // copy, DROP old, RENAME). SQLite fires ON DELETE CASCADE on child tables even
  // for DROP TABLE when foreign_keys=ON, so we must toggle it outside the
  // transaction and restore it afterward.
  const needsFkToggle = currentVersion < 5 || currentVersion < 6;
  if (needsFkToggle) {
    db.exec("PRAGMA foreign_keys = OFF");
  }

  try {
    db.transaction(() => {
      for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
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
