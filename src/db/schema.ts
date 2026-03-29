import type Database from "better-sqlite3";

const SCHEMA_VERSION = 1;

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

    CREATE TABLE IF NOT EXISTS presets (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      tags        TEXT NOT NULL DEFAULT '[]',
      is_template INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS preset_resources (
      preset_id   TEXT NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
      resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      "order"     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (preset_id, resource_id)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      git_origin  TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL DEFAULT '',
      local_path  TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_presets (
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      preset_id   TEXT NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
      platforms   TEXT NOT NULL DEFAULT '[]',
      applied_at  TEXT NOT NULL,
      PRIMARY KEY (project_id, preset_id)
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

    INSERT INTO schema_version (version) VALUES (${SCHEMA_VERSION});
  `,
};

export function initializeSchema(db: Database.Database): void {
  const currentVersion = getSchemaVersion(db);

  if (currentVersion >= SCHEMA_VERSION) return;

  db.transaction(() => {
    for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
      const migration = MIGRATIONS[v];
      if (migration) {
        db.exec(migration);
      }
    }

    if (currentVersion > 0) {
      db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
    }
  })();
}

function getSchemaVersion(db: Database.Database): number {
  try {
    const row = db
      .prepare("SELECT version FROM schema_version LIMIT 1")
      .get() as { version: number } | undefined;
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}
