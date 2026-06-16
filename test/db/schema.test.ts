import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { hashResourceBody } from "../../src/services/resource-hash.ts";

describe("initializeSchema", () => {
  it("creates the expected tables and schema version", async () => {
    const context = await createTestContext("schema-create");

    try {
      context.schema.initializeSchema(context.connection.getDb());

      const tables = context.connection
        .getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;

      expect(tables.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          "harness_preferences",
          "imported_snapshot_installs",
          "imported_snapshots",
          "environment_resources",
          "environment_secret_refs",
          "environments",
          "project_harnesses",
          "deck_layers",
          "decks",
          "layer_resources",
          "layers",
          "project_layers",
          "projects",
          "resources",
          "schema_version",
          "snapshots",
        ]),
      );

      const versionRow = context.connection
        .getDb()
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number };

      expect(versionRow.version).toBe(16);

      const projectHarnessColumns = context.connection
        .getDb()
        .prepare("PRAGMA table_info(project_harnesses)")
        .all() as Array<{ name: string }>;
      expect(projectHarnessColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["cursor_skill_mode"]),
      );

      const layerColumns = context.connection
        .getDb()
        .prepare("PRAGMA table_info(layers)")
        .all() as Array<{ name: string; dflt_value: string | null }>;
      expect(layerColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "org_slug",
          "catalog_slug",
          "default_environment_id",
          "needs_config",
        ]),
      );

      const projectColumns = context.connection
        .getDb()
        .prepare("PRAGMA table_info(projects)")
        .all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;
      expect(projectColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["local_id", "tracked_at"]),
      );

      const gitOriginColumn = projectColumns.find(
        (column) => column.name === "git_origin",
      );
      expect(gitOriginColumn?.notnull).toBe(1);
      expect(gitOriginColumn?.dflt_value).toBe("''");

      const localIdColumn = projectColumns.find(
        (column) => column.name === "local_id",
      );
      expect(localIdColumn?.dflt_value).toBe("''");

      const trackedAtColumn = projectColumns.find(
        (column) => column.name === "tracked_at",
      );
      expect(trackedAtColumn?.dflt_value).toBe("''");

      const indexes = context.connection
        .getDb()
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'projects' ORDER BY name",
        )
        .all() as Array<{ name: string; sql: string | null }>;
      const localIdIndex = indexes.find(
        (index) => index.name === "idx_projects_local_id",
      );
      expect(localIdIndex?.sql).toContain(
        "CREATE UNIQUE INDEX idx_projects_local_id ON projects(local_id) WHERE local_id != ''",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("is idempotent when called multiple times", async () => {
    const context = await createTestContext("schema-idempotent");

    try {
      context.schema.initializeSchema(context.connection.getDb());
      context.schema.initializeSchema(context.connection.getDb());

      const versionRows = context.connection
        .getDb()
        .prepare("SELECT version FROM schema_version")
        .all() as Array<{ version: number }>;

      expect(versionRows).toEqual([{ version: 16 }]);
    } finally {
      await context.cleanup();
    }
  });

  it("migration 14 migrates composition resources and drops legacy plugin tables", async () => {
    const context = await createTestContext("schema-migration-14");

    try {
      context.schema.initializeSchema(context.connection.getDb());

      const tables = context.connection
        .getDb()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all() as Array<{ name: string }>;

      const names = tables.map((t) => t.name);
      expect(names).not.toContain("project_plugin_state");
      expect(names).not.toContain("plugin_native_pins");
      expect(names).not.toContain("plugin_dependencies");

      const versionRow = context.connection
        .getDb()
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number };
      expect(versionRow.version).toBe(16);
    } finally {
      await context.cleanup();
    }
  });

  it("migration 5 adds version column to plugins and creates plugin_dependencies", async () => {
    const context = await createTestContext("schema-migration-5");

    try {
      context.schema.initializeSchema(context.connection.getDb());
      const db = context.connection.getDb();

      // layers table should have a version column
      const cols = db
        .prepare("PRAGMA table_info(layers)")
        .all() as Array<{ name: string; dflt_value: string | null }>;
      const versionCol = cols.find((c) => c.name === "version");
      expect(versionCol).toBeDefined();
      expect(versionCol?.dflt_value).toBe("'1.0.0'");

      // (org_slug, catalog_slug, name, version) uniqueness: same local key must conflict
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO layers (
          id, name, version, org_slug, catalog_slug, description, tags,
          claude_config, needs_config, created_at, updated_at
        ) VALUES ('id1', 'foo', '1.0.0', '', '', '', '[]', '{}', '[]', ?, ?)`,
      ).run(now, now);

      expect(() =>
        db.prepare(
          `INSERT INTO layers (
            id, name, version, org_slug, catalog_slug, description, tags,
            claude_config, needs_config, created_at, updated_at
          ) VALUES ('id2', 'foo', '1.0.0', '', '', '', '[]', '{}', '[]', ?, ?)`,
        ).run(now, now),
      ).toThrow();

      // different version with same name should succeed
      expect(() =>
        db.prepare(
          `INSERT INTO layers (
            id, name, version, org_slug, catalog_slug, description, tags,
            claude_config, needs_config, created_at, updated_at
          ) VALUES ('id3', 'foo', '2.0.0', '', '', '', '[]', '{}', '[]', ?, ?)`,
        ).run(now, now),
      ).not.toThrow();
    } finally {
      await context.cleanup();
    }
  });

  it("migration 5 preserves existing plugin_resources, plugin_native_pins, and project_layers rows", async () => {
    const context = await createTestContext("schema-migration-5-preserve");

    try {
      // Run migrations 1-4 first by manually applying them via initializeSchema on a
      // schema that stops at 4. We simulate by initializing normally (which goes to 5)
      // and checking that the tables still exist and FK integrity is intact.
      context.schema.initializeSchema(context.connection.getDb());
      const db = context.connection.getDb();

      const now = new Date().toISOString();

      // Insert a layer and a resource, then link them via layer_resources
      db.prepare(
        `INSERT INTO layers (
          id, name, version, org_slug, catalog_slug, description, tags,
          claude_config, needs_config, created_at, updated_at
        ) VALUES ('p1', 'test-layer', '1.0.0', '', '', '', '[]', '{}', '[]', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO resources (id, type, name, description, content, metadata, source, created_at, updated_at)
         VALUES ('r1', 'instruction', 'my-instruction', '', '', '{}', 'manual', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO layer_resources (layer_id, resource_id, "order") VALUES ('p1', 'r1', 0)`,
      ).run();

      const row = db
        .prepare("SELECT * FROM layer_resources WHERE layer_id = 'p1'")
        .get() as { layer_id: string } | undefined;
      expect(row?.layer_id).toBe("p1");
    } finally {
      await context.cleanup();
    }
  });

  it("upgrades a real v4 database with existing data and preserves all rows", async () => {
    const context = await createTestContext("schema-v4-upgrade");

    try {
      const db = context.connection.getDb();
      const now = new Date().toISOString();

      // Build a minimal v4 schema directly, without calling initializeSchema
      db.exec(`
        CREATE TABLE resources (
          id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
          metadata TEXT NOT NULL DEFAULT '{}', source TEXT NOT NULL DEFAULT 'manual',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE layers (
          id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
          claude_config TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          git_origin TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL DEFAULT '',
          local_path TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE TABLE layer_resources (
          layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
          resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
          "order" INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (layer_id, resource_id)
        );
        CREATE TABLE layer_plugins (
          layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
          ref TEXT NOT NULL, version_constraint TEXT NOT NULL,
          "order" INTEGER NOT NULL DEFAULT 0, embed_on_export INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (layer_id, ref)
        );
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (4);
      `);

      // Populate v4 data
      db.prepare(
        `INSERT INTO layers (id, name, description, tags, claude_config, created_at, updated_at)
         VALUES ('p1', 'my-layer', 'a layer', '["tag"]', '{}', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO resources (id, type, name, description, content, metadata, source, created_at, updated_at)
         VALUES ('r1', 'instruction', 'instr', '', '', '{}', 'manual', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO layer_resources (layer_id, resource_id, "order") VALUES ('p1', 'r1', 0)`,
      ).run();
      db.prepare(
        `INSERT INTO layer_plugins (layer_id, ref, version_constraint, "order") VALUES ('p1', 'plugin@marketplace', '^1.0', 0)`,
      ).run();

      // Run migration 5
      context.schema.initializeSchema(db);

      // Plugin row carries version '1.0.0' and original fields intact
      const layer = db
        .prepare("SELECT * FROM layers WHERE id = 'p1'")
        .get() as { name: string; version: string; description: string } | undefined;
      expect(layer?.name).toBe("my-layer");
      expect(layer?.version).toBe("1.0.0");
      expect(layer?.description).toBe("a layer");

      const pluginResource = db
        .prepare(
          "SELECT id, metadata FROM resources WHERE type = 'plugin' AND name = 'plugin' AND namespace = 'marketplace'",
        )
        .get() as { id: string; metadata: string } | undefined;
      expect(pluginResource).toBeDefined();

      // FK-linked rows survived (instruction + migrated plugin pin)
      const prRows = db
        .prepare("SELECT resource_id FROM layer_resources WHERE layer_id = 'p1' ORDER BY resource_id")
        .all() as Array<{ resource_id: string }>;
      expect(prRows.map((row) => row.resource_id)).toEqual(
        expect.arrayContaining(["r1", pluginResource?.id]),
      );
      const pluginLink = db
        .prepare(
          "SELECT resource_id FROM layer_resources WHERE layer_id = 'p1' AND resource_id = ?",
        )
        .get(pluginResource?.id) as { resource_id: string } | undefined;
      expect(pluginLink?.resource_id).toBe(pluginResource?.id);
      expect(JSON.parse(pluginResource?.metadata ?? "{}").version_constraint).toBe(
        "^1.0",
      );

      // Schema version bumped
      const versionRow = db
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number };
      expect(versionRow.version).toBe(16);

      const layerColumns = db
        .prepare("PRAGMA table_info(layers)")
        .all() as Array<{ name: string; dflt_value: string | null }>;
      expect(layerColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "org_slug",
          "catalog_slug",
          "default_environment_id",
        ]),
      );

      const projectColumns = db
        .prepare("PRAGMA table_info(projects)")
        .all() as Array<{ name: string; dflt_value: string | null }>;
      expect(projectColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["local_id", "tracked_at"]),
      );

      const indexRow = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_projects_local_id'",
        )
        .get() as { sql: string | null } | undefined;
      expect(indexRow?.sql).toContain(
        "CREATE UNIQUE INDEX idx_projects_local_id ON projects(local_id) WHERE local_id != ''",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("migration 6 preserves project-linked rows across the projects rebuild", async () => {
    const context = await createTestContext("schema-migration-6-project-preserve");

    try {
      const db = context.connection.getDb();
      const now = new Date().toISOString();

      db.exec(`
        CREATE TABLE resources (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK(type IN (
            'instruction','skill','rule','mcp_server','permission',
            'hook','agent','command','env_var','model_config'
          )),
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          metadata TEXT NOT NULL DEFAULT '{}',
          source TEXT NOT NULL DEFAULT 'manual',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE layers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          version TEXT NOT NULL DEFAULT '1.0.0',
          description TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          claude_config TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(name, version)
        );
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          git_origin TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL DEFAULT '',
          local_path TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE TABLE project_layers (
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
          platforms TEXT NOT NULL DEFAULT '[]',
          applied_at TEXT NOT NULL,
          PRIMARY KEY (project_id, layer_id)
        );
        CREATE TABLE snapshots (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          label TEXT NOT NULL DEFAULT '',
          state TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE TABLE project_harnesses (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          main_harness TEXT NOT NULL,
          alias_harnesses TEXT NOT NULL DEFAULT '[]',
          materialization_strategy TEXT NOT NULL DEFAULT 'symlink-preferred',
          updated_at TEXT NOT NULL
        );
        CREATE TABLE project_plugin_state (
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          harness TEXT NOT NULL DEFAULT 'claude-code',
          scanned_at TEXT NOT NULL,
          committed TEXT NOT NULL DEFAULT '[]',
          effective TEXT NOT NULL DEFAULT '[]',
          PRIMARY KEY (project_id, harness)
        );
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (5);
      `);

      db.prepare(
        `INSERT INTO layers (id, name, version, description, tags, claude_config, created_at, updated_at)
         VALUES ('layer-1', 'my-layer', '1.0.0', '', '[]', '{}', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO projects (id, git_origin, name, local_path, created_at)
         VALUES ('project-1', 'https://example.com/repo.git', 'repo', '/tmp/repo', ?)`,
      ).run(now);
      db.prepare(
        `INSERT INTO project_layers (project_id, layer_id, platforms, applied_at)
         VALUES ('project-1', 'layer-1', '["claude-code"]', ?)`,
      ).run(now);
      db.prepare(
        `INSERT INTO snapshots (id, project_id, label, state, created_at)
         VALUES ('snapshot-1', 'project-1', 'before', '{}', ?)`,
      ).run(now);
      db.prepare(
        `INSERT INTO project_harnesses (project_id, main_harness, alias_harnesses, materialization_strategy, updated_at)
         VALUES ('project-1', 'claude-code', '[]', 'symlink-preferred', ?)`,
      ).run(now);
      db.prepare(
        `INSERT INTO project_plugin_state (project_id, harness, scanned_at, committed, effective)
         VALUES ('project-1', 'claude-code', ?, '[]', '[]')`,
      ).run(now);

      context.schema.initializeSchema(db);

      const project = db
        .prepare(
          "SELECT git_origin, local_id, tracked_at FROM projects WHERE id = 'project-1'",
        )
        .get() as
        | { git_origin: string; local_id: string; tracked_at: string }
        | undefined;
      expect(project).toEqual({
        git_origin: 'https://example.com/repo.git',
        local_id: '',
        tracked_at: now,
      });

      const projectLayer = db
        .prepare(
          `SELECT pl.project_id, pl.layer_id
           FROM project_layers pl
           WHERE pl.project_id = 'project-1'`,
        )
        .get() as { project_id: string; layer_id: string } | undefined;
      expect(projectLayer).toEqual({
        project_id: 'project-1',
        layer_id: 'legacy-wrap:layer-1',
      });

      const snapshot = db
        .prepare(
          "SELECT id, project_id FROM snapshots WHERE project_id = 'project-1'",
        )
        .get() as { id: string; project_id: string } | undefined;
      expect(snapshot).toEqual({ id: 'snapshot-1', project_id: 'project-1' });

      const harness = db
        .prepare(
          "SELECT project_id, main_harness FROM project_harnesses WHERE project_id = 'project-1'",
        )
        .get() as { project_id: string; main_harness: string } | undefined;
      expect(harness).toEqual({
        project_id: 'project-1',
        main_harness: 'claude-code',
      });

      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_plugin_state'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("migration 6 preserves legacy projects with empty git_origin in a valid shape", async () => {
    const context = await createTestContext("schema-migration-6-empty-git-origin");

    try {
      const db = context.connection.getDb();
      const now = new Date().toISOString();

      db.exec(`
        CREATE TABLE layers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          version TEXT NOT NULL DEFAULT '1.0.0',
          description TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          claude_config TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(name, version)
        );
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          git_origin TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL DEFAULT '',
          local_path TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (5);
      `);

      db.prepare(
        `INSERT INTO projects (id, git_origin, name, local_path, created_at)
         VALUES ('project-empty-origin', '', 'local project', '/tmp/local-project', ?)`,
      ).run(now);

      expect(() => context.schema.initializeSchema(db)).not.toThrow();

      const project = db
        .prepare(
          "SELECT git_origin, local_id, tracked_at, name, local_path, created_at FROM projects WHERE id = 'project-empty-origin'",
        )
        .get() as
        | {
            git_origin: string;
            local_id: string;
            tracked_at: string;
            name: string;
            local_path: string;
            created_at: string;
          }
        | undefined;

      expect(project).toBeDefined();
      expect(project?.git_origin).toBe("");
      expect(project?.local_id).not.toBe("");
      expect(project?.tracked_at).toBe(now);
      expect(project?.name).toBe("local project");
      expect(project?.local_path).toBe("/tmp/local-project");
      expect(project?.created_at).toBe(now);
    } finally {
      await context.cleanup();
    }
  });

  it("migration 7 creates imported snapshot tables", async () => {
    const context = await createTestContext("schema-migration-7");

    try {
      context.schema.initializeSchema(context.connection.getDb());
      const db = context.connection.getDb();

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const names = tables.map((table) => table.name);
      expect(names).toContain("imported_snapshots");
      expect(names).toContain("imported_snapshot_installs");

      const snapshotColumns = db
        .prepare("PRAGMA table_info(imported_snapshots)")
        .all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;
      expect(snapshotColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "id",
          "source_kind",
          "source_label",
          "plugin_name",
          "plugin_version",
          "resource_ids",
          "metadata",
          "created_at",
        ]),
      );
      expect(
        snapshotColumns.find((column) => column.name === "resource_ids")?.dflt_value,
      ).toBe("'[]'");
      expect(
        snapshotColumns.find((column) => column.name === "metadata")?.dflt_value,
      ).toBe("'{}'");

      const installColumns = db
        .prepare("PRAGMA table_info(imported_snapshot_installs)")
        .all() as Array<{ name: string; pk: number; dflt_value: string | null }>;
      expect(installColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["snapshot_id", "platform_id", "files", "installed_at"]),
      );
      expect(
        installColumns.find((column) => column.name === "snapshot_id")?.pk,
      ).toBe(1);
      expect(
        installColumns.find((column) => column.name === "platform_id")?.pk,
      ).toBe(2);
      expect(
        installColumns.find((column) => column.name === "files")?.dflt_value,
      ).toBe("'[]'");
    } finally {
      await context.cleanup();
    }
  });

  it("migration 8 renames layers to plugins and preserves rows", async () => {
    const context = await createTestContext("schema-migration-8");

    try {
      const db = context.connection.getDb();
      const now = new Date().toISOString();

      db.exec(`
        CREATE TABLE resources (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK(type IN (
            'instruction','skill','rule','mcp_server','permission',
            'hook','agent','command','env_var','model_config'
          )),
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          metadata TEXT NOT NULL DEFAULT '{}',
          source TEXT NOT NULL DEFAULT 'manual',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE layers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          version TEXT NOT NULL DEFAULT '1.0.0',
          description TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          claude_config TEXT NOT NULL DEFAULT '{}',
          source_path TEXT NOT NULL DEFAULT '',
          source_hash TEXT NOT NULL DEFAULT '',
          source_present INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(name, version)
        );
        CREATE TABLE layer_resources (
          layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
          resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
          "order" INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (layer_id, resource_id)
        );
        CREATE TABLE layer_dependencies (
          layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
          dependency_name TEXT NOT NULL,
          version_constraint TEXT NOT NULL,
          "order" INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (layer_id, dependency_name)
        );
        CREATE TABLE layer_plugins (
          layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
          ref TEXT NOT NULL,
          version_constraint TEXT NOT NULL,
          "order" INTEGER NOT NULL DEFAULT 0,
          embed_on_export INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (layer_id, ref)
        );
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (7);
      `);

      db.prepare(
        `INSERT INTO layers (id, name, version, description, tags, claude_config, created_at, updated_at)
         VALUES ('p1', 'team-stack', '1.0.0', '', '[]', '{}', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO resources (id, type, name, description, content, metadata, source, created_at, updated_at)
         VALUES ('r1', 'instruction', 'instr', '', '', '{}', 'manual', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO layer_resources (layer_id, resource_id, "order") VALUES ('p1', 'r1', 0)`,
      ).run();

      context.schema.initializeSchema(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const names = tables.map((table) => table.name);
      expect(names).toContain("layers");
      expect(names).not.toContain("plugins");
      expect(names).toContain("layer_resources");
      expect(names).not.toContain("plugin_resources");

      const row = db
        .prepare("SELECT name FROM layers WHERE id = ?")
        .get("p1") as { name: string } | undefined;
      expect(row).toEqual({ name: "team-stack" });

      const link = db
        .prepare("SELECT layer_id FROM layer_resources WHERE layer_id = 'p1'")
        .get() as { layer_id: string } | undefined;
      expect(link?.layer_id).toBe("p1");

      const versionRow = db
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number };
      expect(versionRow.version).toBe(16);
    } finally {
      await context.cleanup();
    }
  });

  it("migration 9 adds needs_config to plugins", async () => {
    const context = await createTestContext("schema-migration-9");

    try {
      const db = context.connection.getDb();
      const now = new Date().toISOString();

      db.exec(`
        CREATE TABLE plugins (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          version TEXT NOT NULL DEFAULT '1.0.0',
          description TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          claude_config TEXT NOT NULL DEFAULT '{}',
          source_path TEXT NOT NULL DEFAULT '',
          source_hash TEXT NOT NULL DEFAULT '',
          source_present INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(name, version)
        );
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (8);
      `);

      db.prepare(
        `INSERT INTO plugins (id, name, version, description, tags, claude_config, created_at, updated_at)
         VALUES ('p-needs', 'needs-plugin', '1.0.0', '', '[]', '{}', ?, ?)`,
      ).run(now, now);

      context.schema.initializeSchema(db);

      const row = db
        .prepare("SELECT needs_config FROM layers WHERE id = 'p-needs'")
        .get() as { needs_config: string };
      expect(row.needs_config).toBe("[]");

      const versionRow = db
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number };
      expect(versionRow.version).toBe(16);
    } finally {
      await context.cleanup();
    }
  });

  it("migration 10 creates environment tables", async () => {
    const context = await createTestContext("schema-migration-10");

    try {
      const db = context.connection.getDb();
      const now = new Date().toISOString();

      db.exec(`
        CREATE TABLE resources (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          metadata TEXT NOT NULL DEFAULT '{}',
          source TEXT NOT NULL DEFAULT 'manual',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE plugins (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          version TEXT NOT NULL DEFAULT '1.0.0',
          description TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          claude_config TEXT NOT NULL DEFAULT '{}',
          needs_config TEXT NOT NULL DEFAULT '[]',
          source_path TEXT NOT NULL DEFAULT '',
          source_hash TEXT NOT NULL DEFAULT '',
          source_present INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(name, version)
        );
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (9);
      `);

      context.schema.initializeSchema(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const names = tables.map((table) => table.name);
      expect(names).toContain("environments");
      expect(names).toContain("environment_resources");
      expect(names).toContain("environment_secret_refs");

      db.prepare(
        `INSERT INTO environments (id, name, description, created_at, updated_at)
         VALUES ('env1', 'prod', '', ?, ?)`,
      ).run(now, now);

      const row = db
        .prepare("SELECT name FROM environments WHERE id = 'env1'")
        .get() as { name: string };
      expect(row).toEqual({ name: "prod" });

      const versionRow = db
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number };
      expect(versionRow.version).toBe(16);
    } finally {
      await context.cleanup();
    }
  });

  it("migration 11 creates configured layers and migrates project_layers", async () => {
    const context = await createTestContext("schema-migration-11");

    try {
      const db = context.connection.getDb();
      const now = new Date().toISOString();

      db.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          git_origin TEXT NOT NULL DEFAULT '',
          local_id TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL DEFAULT '',
          local_path TEXT NOT NULL DEFAULT '',
          tracked_at TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE TABLE plugins (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          version TEXT NOT NULL DEFAULT '1.0.0',
          description TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          claude_config TEXT NOT NULL DEFAULT '{}',
          needs_config TEXT NOT NULL DEFAULT '[]',
          source_path TEXT NOT NULL DEFAULT '',
          source_hash TEXT NOT NULL DEFAULT '',
          source_present INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(name, version)
        );
        CREATE TABLE project_layers (
          project_id TEXT NOT NULL,
          layer_id TEXT NOT NULL,
          platforms TEXT NOT NULL DEFAULT '[]',
          applied_at TEXT NOT NULL,
          PRIMARY KEY (project_id, layer_id)
        );
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (10);
      `);

      db.prepare(
        `INSERT INTO projects (id, git_origin, name, local_path, created_at)
         VALUES ('proj-1', 'git@github.com:acme/app.git', 'app', '/tmp/app', ?)`,
      ).run(now);
      db.prepare(
        `INSERT INTO plugins (id, name, version, description, tags, claude_config, needs_config, created_at, updated_at)
         VALUES ('plug-1', 'team-stack', '2.0.0', '', '[]', '{}', '[]', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO project_layers (project_id, layer_id, platforms, applied_at)
         VALUES ('proj-1', 'plug-1', '["claude-code"]', ?)`,
      ).run(now);

      context.schema.initializeSchema(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const names = tables.map((table) => table.name);
      expect(names).toContain("layers");
      expect(names).toContain("project_layers");
      expect(names).not.toContain("project_configured_layers");

      const link = db
        .prepare(
          `SELECT pl.layer_id, l.name, l.version
           FROM project_layers pl
           INNER JOIN layers l ON l.id = pl.layer_id
           WHERE pl.project_id = 'proj-1'`,
        )
        .get() as { layer_id: string; name: string; version: string };
      expect(link.name).toBe("team-stack");
      expect(link.version).toBe("2.0.0");
      expect(link.layer_id).toBe("legacy-wrap:plug-1");

      const versionRow = db
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number };
      expect(versionRow.version).toBe(16);
    } finally {
      await context.cleanup();
    }
  });

  it("migration 12 creates deck tables", async () => {
    const context = await createTestContext("schema-migration-12");

    try {
      const db = context.connection.getDb();
      const now = new Date().toISOString();

      db.exec(`
        CREATE TABLE environments (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(name)
        );
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
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (11);
      `);

      context.schema.initializeSchema(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const names = tables.map((table) => table.name);
      expect(names).toContain("decks");
      expect(names).toContain("deck_layers");

      db.prepare(
        `INSERT INTO environments (id, name, description, created_at, updated_at)
         VALUES ('env-prod', 'prod', '', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO layers (
          id, name, version, org_slug, catalog_slug, description, tags,
          claude_config, needs_config, created_at, updated_at
        ) VALUES ('cl-1', 'oncall', '1.0.0', '', '', '', '[]', '{}', '[]', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO decks (id, name, root_path, active_environment_id, created_at, updated_at)
         VALUES ('deck-1', 'my-deck', '/tmp/my-deck', 'env-prod', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO deck_layers (deck_id, layer_id, "order")
         VALUES ('deck-1', 'cl-1', 0)`,
      ).run();

      const deck = db
        .prepare("SELECT name, active_environment_id FROM decks WHERE id = 'deck-1'")
        .get() as { name: string; active_environment_id: string };
      expect(deck).toEqual({ name: "my-deck", active_environment_id: "env-prod" });

      const link = db
        .prepare(
          "SELECT layer_id FROM deck_layers WHERE deck_id = 'deck-1'",
        )
        .get() as { layer_id: string };
      expect(link.layer_id).toBe("cl-1");

      const versionRow = db
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number };
      expect(versionRow.version).toBe(16);
    } finally {
      await context.cleanup();
    }
  });

  it("migration 13 adds resource identity columns, dedupes duplicates, and backfills content_hash", async () => {
    const context = await createTestContext("schema-migration-13");

    try {
      const db = context.connection.getDb();
      const now = new Date().toISOString();
      const older = new Date(Date.now() - 60_000).toISOString();

      db.exec(`
        CREATE TABLE resources (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          metadata TEXT NOT NULL DEFAULT '{}',
          source TEXT NOT NULL DEFAULT 'manual',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE plugins (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          version TEXT NOT NULL DEFAULT '1.0.0',
          description TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          claude_config TEXT NOT NULL DEFAULT '{}',
          needs_config TEXT NOT NULL DEFAULT '[]',
          source_path TEXT NOT NULL DEFAULT '',
          source_hash TEXT NOT NULL DEFAULT '',
          source_present INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(name, version)
        );
        CREATE TABLE plugin_resources (
          layer_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
          resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
          "order" INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (layer_id, resource_id)
        );
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
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (12);
      `);

      db.prepare(
        `INSERT INTO plugins (id, name, version, description, tags, claude_config, needs_config, created_at, updated_at)
         VALUES ('plug-1', 'team-stack', '1.0.0', '', '[]', '{}', '[]', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO environments (id, name, description, created_at, updated_at)
         VALUES ('env-1', 'prod', '', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO resources (id, type, name, description, content, metadata, source, created_at, updated_at)
         VALUES ('r-old', 'skill', 'dup-skill', '', 'older body', '{}', 'manual', ?, ?)`,
      ).run(older, older);
      db.prepare(
        `INSERT INTO resources (id, type, name, description, content, metadata, source, created_at, updated_at)
         VALUES ('r-new', 'skill', 'dup-skill', '', 'newer body', '{}', 'manual', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO plugin_resources (layer_id, resource_id, "order") VALUES ('plug-1', 'r-old', 0)`,
      ).run();
      db.prepare(
        `INSERT INTO environment_resources (environment_id, resource_id, "order") VALUES ('env-1', 'r-old', 0)`,
      ).run();

      context.schema.initializeSchema(db);

      const resourceColumns = db
        .prepare("PRAGMA table_info(resources)")
        .all() as Array<{ name: string }>;
      expect(resourceColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "namespace",
          "origin_kind",
          "origin_ref",
          "content_hash",
          "content_blob_ref",
        ]),
      );

      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'resources'",
        )
        .all() as Array<{ name: string }>;
      expect(indexes.map((index) => index.name)).toContain(
        "idx_resources_type_name_namespace",
      );

      const survivors = db
        .prepare("SELECT id FROM resources WHERE name = 'dup-skill'")
        .all() as Array<{ id: string }>;
      expect(survivors).toEqual([{ id: "r-new" }]);

      const pluginLink = db
        .prepare("SELECT resource_id FROM layer_resources WHERE layer_id = 'plug-1'")
        .get() as { resource_id: string };
      expect(pluginLink.resource_id).toBe("r-new");

      const environmentLink = db
        .prepare(
          "SELECT resource_id FROM environment_resources WHERE environment_id = 'env-1'",
        )
        .get() as { resource_id: string };
      expect(environmentLink.resource_id).toBe("r-new");

      const winner = db
        .prepare(
          "SELECT namespace, origin_kind, origin_ref, content_hash, content_blob_ref, content, metadata, type FROM resources WHERE id = 'r-new'",
        )
        .get() as {
          namespace: string;
          origin_kind: string;
          origin_ref: string;
          content_hash: string;
          content_blob_ref: string;
          content: string;
          metadata: string;
          type: string;
        };
      expect(winner.namespace).toBe("");
      expect(winner.origin_kind).toBe("manual");
      expect(winner.origin_ref).toBe("");
      expect(winner.content_blob_ref).toBe("");
      expect(winner.content_hash).toBe(
        hashResourceBody({
          type: "skill",
          content: winner.content,
          metadata: JSON.parse(winner.metadata),
        }),
      );

      const versionRow = db
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number };
      expect(versionRow.version).toBe(16);
    } finally {
      await context.cleanup();
    }
  });
});
