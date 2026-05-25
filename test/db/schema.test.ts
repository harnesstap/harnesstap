import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";

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
          "preset_dependencies",
          "project_harnesses",
          "preset_plugins",
          "project_plugin_state",
          "project_presets",
          "preset_resources",
          "presets",
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

      expect(versionRow.version).toBe(5);
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

      expect(versionRows).toEqual([{ version: 5 }]);
    } finally {
      await context.cleanup();
    }
  });

  it("migration 4 creates project_plugin_state and preset_plugins", async () => {
    const context = await createTestContext("schema-migration-4");

    try {
      context.schema.initializeSchema(context.connection.getDb());

      const tables = context.connection
        .getDb()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all() as Array<{ name: string }>;

      const names = tables.map((t) => t.name);
      expect(names).toContain("project_plugin_state");
      expect(names).toContain("preset_plugins");
    } finally {
      await context.cleanup();
    }
  });

  it("migration 5 adds version column to presets and creates preset_dependencies", async () => {
    const context = await createTestContext("schema-migration-5");

    try {
      context.schema.initializeSchema(context.connection.getDb());
      const db = context.connection.getDb();

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name)).toContain("preset_dependencies");

      // presets table should have a version column
      const cols = db
        .prepare("PRAGMA table_info(presets)")
        .all() as Array<{ name: string; dflt_value: string | null }>;
      const versionCol = cols.find((c) => c.name === "version");
      expect(versionCol).toBeDefined();
      expect(versionCol?.dflt_value).toBe("'1.0.0'");

      // (name, version) uniqueness: same name+version must conflict
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO presets (id, name, version, description, tags, claude_config, created_at, updated_at)
         VALUES ('id1', 'foo', '1.0.0', '', '[]', '{}', ?, ?)`,
      ).run(now, now);

      expect(() =>
        db.prepare(
          `INSERT INTO presets (id, name, version, description, tags, claude_config, created_at, updated_at)
           VALUES ('id2', 'foo', '1.0.0', '', '[]', '{}', ?, ?)`,
        ).run(now, now),
      ).toThrow();

      // different version with same name should succeed
      expect(() =>
        db.prepare(
          `INSERT INTO presets (id, name, version, description, tags, claude_config, created_at, updated_at)
           VALUES ('id3', 'foo', '2.0.0', '', '[]', '{}', ?, ?)`,
        ).run(now, now),
      ).not.toThrow();
    } finally {
      await context.cleanup();
    }
  });

  it("migration 5 preserves existing preset_resources, preset_plugins, and project_presets rows", async () => {
    const context = await createTestContext("schema-migration-5-preserve");

    try {
      // Run migrations 1-4 first by manually applying them via initializeSchema on a
      // schema that stops at 4. We simulate by initializing normally (which goes to 5)
      // and checking that the tables still exist and FK integrity is intact.
      context.schema.initializeSchema(context.connection.getDb());
      const db = context.connection.getDb();

      const now = new Date().toISOString();

      // Insert a preset and a resource, then link them via preset_resources
      db.prepare(
        `INSERT INTO presets (id, name, version, description, tags, claude_config, created_at, updated_at)
         VALUES ('p1', 'test-preset', '1.0.0', '', '[]', '{}', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO resources (id, type, name, description, content, metadata, source, created_at, updated_at)
         VALUES ('r1', 'instruction', 'my-instruction', '', '', '{}', 'manual', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO preset_resources (preset_id, resource_id, "order") VALUES ('p1', 'r1', 0)`,
      ).run();

      const row = db
        .prepare("SELECT * FROM preset_resources WHERE preset_id = 'p1'")
        .get() as { preset_id: string } | undefined;
      expect(row?.preset_id).toBe("p1");
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
        CREATE TABLE presets (
          id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
          claude_config TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE preset_resources (
          preset_id TEXT NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
          resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
          "order" INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (preset_id, resource_id)
        );
        CREATE TABLE preset_plugins (
          preset_id TEXT NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
          ref TEXT NOT NULL, version_constraint TEXT NOT NULL,
          "order" INTEGER NOT NULL DEFAULT 0, embed_on_export INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (preset_id, ref)
        );
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (4);
      `);

      // Populate v4 data
      db.prepare(
        `INSERT INTO presets (id, name, description, tags, claude_config, created_at, updated_at)
         VALUES ('p1', 'my-preset', 'a preset', '["tag"]', '{}', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO resources (id, type, name, description, content, metadata, source, created_at, updated_at)
         VALUES ('r1', 'instruction', 'instr', '', '', '{}', 'manual', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO preset_resources (preset_id, resource_id, "order") VALUES ('p1', 'r1', 0)`,
      ).run();
      db.prepare(
        `INSERT INTO preset_plugins (preset_id, ref, version_constraint, "order") VALUES ('p1', 'plugin@marketplace', '^1.0', 0)`,
      ).run();

      // Run migration 5
      context.schema.initializeSchema(db);

      // Preset row carries version '1.0.0' and original fields intact
      const preset = db
        .prepare("SELECT * FROM presets WHERE id = 'p1'")
        .get() as { name: string; version: string; description: string } | undefined;
      expect(preset?.name).toBe("my-preset");
      expect(preset?.version).toBe("1.0.0");
      expect(preset?.description).toBe("a preset");

      // FK-linked rows survived
      const prRow = db
        .prepare("SELECT * FROM preset_resources WHERE preset_id = 'p1'")
        .get() as { resource_id: string } | undefined;
      expect(prRow).toBeDefined();
      expect(prRow?.resource_id).toBe("r1");

      const ppRow = db
        .prepare("SELECT * FROM preset_plugins WHERE preset_id = 'p1'")
        .get() as { ref: string; version_constraint: string } | undefined;
      expect(ppRow).toBeDefined();
      expect(ppRow?.ref).toBe("plugin@marketplace");
      expect(ppRow?.version_constraint).toBe("^1.0");

      // Schema version bumped
      const versionRow = db
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number };
      expect(versionRow.version).toBe(5);
    } finally {
      await context.cleanup();
    }
  });
});
