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
          "global_apply_snapshots",
          "global_apply_snapshot_installs",
          "environment_resources",
          "environment_secret_refs",
          "environments",
          "project_harnesses",
          "layer_resources",
          "layer_publish_targets",
          "layers",
          "project_layers",
          "projects",
          "resources",
          "layer_working_snapshots",
          "schema_version",
          "snapshots",
        ]),
      );

      const versionRow = context.connection
        .getDb()
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number };

      expect(versionRow.version).toBe(23);

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
      expect(localIdIndex?.sql?.replace(/\s+/g, " ")).toContain(
        "CREATE UNIQUE INDEX idx_projects_local_id ON projects(local_id) WHERE local_id != ''",
      );

      const resourceTableSql = context.connection
        .getDb()
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'resources'",
        )
        .get() as { sql: string };
      expect(resourceTableSql.sql).toContain("'plugin_pin'");
      expect(resourceTableSql.sql).not.toContain("'plugin'");

      const resourceIndexes = context.connection
        .getDb()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'resources'",
        )
        .all() as Array<{ name: string }>;
      expect(resourceIndexes.map((index) => index.name)).toContain(
        "idx_resources_type_name_namespace",
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

      expect(versionRows).toEqual([{ version: 23 }]);
    } finally {
      await context.cleanup();
    }
  });

  it("enforces layer uniqueness on org_slug, catalog_slug, name, and version", async () => {
    const context = await createTestContext("schema-layer-uniqueness");

    try {
      context.schema.initializeSchema(context.connection.getDb());
      const db = context.connection.getDb();
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

  it("preserves layer_resources foreign key integrity", async () => {
    const context = await createTestContext("schema-layer-resources-fk");

    try {
      context.schema.initializeSchema(context.connection.getDb());
      const db = context.connection.getDb();
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO layers (
          id, name, version, org_slug, catalog_slug, description, tags,
          claude_config, needs_config, created_at, updated_at
        ) VALUES ('p1', 'test-layer', '1.0.0', '', '', '', '[]', '{}', '[]', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO resources (
          id, type, name, description, content, metadata, source,
          namespace, origin_kind, origin_ref, content_hash, content_blob_ref,
          created_at, updated_at
        ) VALUES ('r1', 'instruction', 'my-instruction', '', '', '{}', 'manual', '', 'manual', '', '', '', ?, ?)`,
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

  it("creates imported snapshot tables with expected columns", async () => {
    const context = await createTestContext("schema-imported-snapshots");

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

      const snapshotTableSql = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'imported_snapshots'",
        )
        .get() as { sql: string };
      expect(snapshotTableSql.sql).toContain("'skill-package'");

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

  it("stores resource identity columns and content_hash", async () => {
    const context = await createTestContext("schema-resource-identity");

    try {
      context.schema.initializeSchema(context.connection.getDb());
      const db = context.connection.getDb();
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO resources (
          id, type, name, description, content, metadata, source,
          namespace, origin_kind, origin_ref, content_hash, content_blob_ref,
          created_at, updated_at
        ) VALUES ('r1', 'skill', 'my-skill', '', 'body', '{}', 'manual', '', 'manual', '', '', '', ?, ?)`,
      ).run(now, now);

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

      const contentHash = hashResourceBody({
        type: "skill",
        content: "body",
        metadata: {},
      });
      db.prepare("UPDATE resources SET content_hash = ? WHERE id = 'r1'").run(
        contentHash,
      );

      const row = db
        .prepare(
          "SELECT namespace, origin_kind, origin_ref, content_hash, content_blob_ref FROM resources WHERE id = 'r1'",
        )
        .get() as {
          namespace: string;
          origin_kind: string;
          origin_ref: string;
          content_hash: string;
          content_blob_ref: string;
        };
      expect(row.namespace).toBe("");
      expect(row.origin_kind).toBe("manual");
      expect(row.origin_ref).toBe("");
      expect(row.content_blob_ref).toBe("");
      expect(row.content_hash).toBe(contentHash);
    } finally {
      await context.cleanup();
    }
  });

  it("allows legacy schema read for migrate export", async () => {
    const context = await createTestContext("schema-legacy-export-read");

    try {
      const db = context.connection.getDb();
      db.exec(`
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (18);
      `);

      expect(() =>
        context.schema.initializeSchema(db, { allowLegacyRead: true }),
      ).not.toThrow();

      const versionRow = db
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number };
      expect(versionRow.version).toBe(18);
    } finally {
      await context.cleanup();
    }
  });

  it("upgrades v22 databases in place to v23 with dirty/frozen_at/snapshots", async () => {
    const context = await createTestContext("schema-v23-upgrade");
    try {
      const db = context.connection.getDb();
      // Simulate a v22 DB: create minimal v22 layers table then stamp version 22
      db.exec(`
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (22);
        CREATE TABLE layers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          version TEXT NOT NULL DEFAULT '1.0.0',
          org_slug TEXT NOT NULL DEFAULT '',
          catalog_slug TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          claude_config TEXT NOT NULL DEFAULT '{}',
          needs_config TEXT NOT NULL DEFAULT '[]',
          default_environment_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(org_slug, catalog_slug, name, version)
        );
      `);

      context.schema.initializeSchema(db);

      const version = (
        db.prepare("SELECT version FROM schema_version LIMIT 1").get() as {
          version: number;
        }
      ).version;
      expect(version).toBe(23);

      const cols = db
        .prepare("PRAGMA table_info(layers)")
        .all() as Array<{ name: string }>;
      expect(cols.map((c) => c.name)).toEqual(
        expect.arrayContaining(["dirty", "frozen_at"]),
      );

      const snap = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='layer_working_snapshots'",
        )
        .get();
      expect(snap).toBeTruthy();
    } finally {
      await context.cleanup();
    }
  });

  it("rejects in-place upgrade from legacy schema versions", async () => {
    const context = await createTestContext("schema-legacy-upgrade-rejected");

    try {
      const db = context.connection.getDb();
      db.exec(`
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (18);
      `);

      expect(() => context.schema.initializeSchema(db)).toThrow(
        /cannot be upgraded in place/,
      );

      const versionRow = db
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number };
      expect(versionRow.version).toBe(18);
    } finally {
      await context.cleanup();
    }
  });
});
