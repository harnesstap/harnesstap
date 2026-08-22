import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import type { SqliteDatabase } from "../../src/db/types.ts";
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
          "plugin_resources",
          "plugin_publish_targets",
          "plugins",
          "project_plugins",
          "projects",
          "resource_materializations",
          "resources",
          "plugin_working_snapshots",
          "schema_version",
          "snapshots",
        ]),
      );

      const versionRow = context.connection
        .getDb()
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number };

      expect(versionRow.version).toBe(30);

      const projectHarnessColumns = context.connection
        .getDb()
        .prepare("PRAGMA table_info(project_harnesses)")
        .all() as Array<{ name: string }>;
      expect(projectHarnessColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["cursor_skill_mode"]),
      );

      const pluginColumns = context.connection
        .getDb()
        .prepare("PRAGMA table_info(plugins)")
        .all() as Array<{ name: string; dflt_value: string | null }>;
      expect(pluginColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "org_slug",
          "catalog_slug",
          "default_environment_id",
          "needs_config",
          "overrides",
          "origin",
          "ap_name",
          "origin_locator",
          "origin_fingerprint",
          "origin_fingerprint_kind",
        ]),
      );

      const globalApplySnapshotColumns = context.connection
        .getDb()
        .prepare("PRAGMA table_info(global_apply_snapshots)")
        .all() as Array<{ name: string }>;
      expect(globalApplySnapshotColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["resolved_set"]),
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
      expect(resourceTableSql.sql).toContain("'plugin'");
      expect(resourceTableSql.sql).not.toContain("'plugin_pin'");

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

      expect(versionRows).toEqual([{ version: 30 }]);
    } finally {
      await context.cleanup();
    }
  });

  it("enforces plugin uniqueness on org_slug, catalog_slug, name, and version", async () => {
    const context = await createTestContext("schema-plugin-uniqueness");

    try {
      context.schema.initializeSchema(context.connection.getDb());
      const db = context.connection.getDb();
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO plugins (
          id, name, version, org_slug, catalog_slug, description, tags,
          claude_config, needs_config, created_at, updated_at
        ) VALUES ('id1', 'foo', '1.0.0', '', '', '', '[]', '{}', '[]', ?, ?)`,
      ).run(now, now);

      expect(() =>
        db.prepare(
          `INSERT INTO plugins (
            id, name, version, org_slug, catalog_slug, description, tags,
            claude_config, needs_config, created_at, updated_at
          ) VALUES ('id2', 'foo', '1.0.0', '', '', '', '[]', '{}', '[]', ?, ?)`,
        ).run(now, now),
      ).toThrow();

      expect(() =>
        db.prepare(
          `INSERT INTO plugins (
            id, name, version, org_slug, catalog_slug, description, tags,
            claude_config, needs_config, created_at, updated_at
          ) VALUES ('id3', 'foo', '2.0.0', '', '', '', '[]', '{}', '[]', ?, ?)`,
        ).run(now, now),
      ).not.toThrow();
    } finally {
      await context.cleanup();
    }
  });

  it("preserves plugin_resources foreign key integrity", async () => {
    const context = await createTestContext("schema-plugin-resources-fk");

    try {
      context.schema.initializeSchema(context.connection.getDb());
      const db = context.connection.getDb();
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO plugins (
          id, name, version, org_slug, catalog_slug, description, tags,
          claude_config, needs_config, created_at, updated_at
        ) VALUES ('p1', 'test-plugin', '1.0.0', '', '', '', '[]', '{}', '[]', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO resources (
          id, type, name, description, content, metadata, source,
          namespace, origin_kind, origin_ref, content_hash, content_blob_ref,
          created_at, updated_at
        ) VALUES ('r1', 'instruction', 'my-instruction', '', '', '{}', 'manual', '', 'manual', '', '', '', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO plugin_resources (plugin_id, resource_id, "order") VALUES ('p1', 'r1', 0)`,
      ).run();

      const row = db
        .prepare("SELECT * FROM plugin_resources WHERE plugin_id = 'p1'")
        .get() as { plugin_id: string } | undefined;
      expect(row?.plugin_id).toBe("p1");
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

  it("upgrades intermediate schemas in place to current with expected columns", async () => {
    const now = new Date().toISOString();
    const fixtures: Array<{
      label: string;
      setup: string;
      seed?: (db: SqliteDatabase) => void;
      assert: (db: SqliteDatabase) => void;
    }> = [
      {
        label: "v22",
        setup: `
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
          CREATE TABLE global_apply_snapshots (
            id TEXT PRIMARY KEY,
            profile_name TEXT NOT NULL,
            layer_ids TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
        `,
        assert: (db) => {
          const cols = db
            .prepare("PRAGMA table_info(plugins)")
            .all() as Array<{ name: string }>;
          expect(cols.map((c) => c.name)).toEqual(
            expect.arrayContaining([
              "dirty",
              "frozen_at",
              "overrides",
              "origin",
              "origin_locator",
              "origin_fingerprint",
              "origin_fingerprint_kind",
            ]),
          );
          expect(
            db
              .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='plugin_working_snapshots'",
              )
              .get(),
          ).toBeTruthy();
          const globalCols = db
            .prepare("PRAGMA table_info(global_apply_snapshots)")
            .all() as Array<{ name: string }>;
          expect(globalCols.map((c) => c.name)).toContain("resolved_set");
        },
      },
      {
        label: "v23",
        setup: `
          CREATE TABLE schema_version (version INTEGER NOT NULL);
          INSERT INTO schema_version (version) VALUES (23);
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
            dirty INTEGER NOT NULL DEFAULT 0,
            frozen_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(org_slug, catalog_slug, name, version)
          );
          CREATE TABLE layer_working_snapshots (
            layer_id TEXT PRIMARY KEY REFERENCES layers(id) ON DELETE CASCADE,
            source_version TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE TABLE global_apply_snapshots (
            id TEXT PRIMARY KEY,
            profile_name TEXT NOT NULL,
            layer_ids TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
        `,
        assert: (db) => {
          const pluginCols = db
            .prepare("PRAGMA table_info(plugins)")
            .all() as Array<{ name: string; dflt_value: string | null }>;
          expect(
            pluginCols.find((c) => c.name === "overrides")?.dflt_value,
          ).toBe("'{}'");
          expect(pluginCols.find((c) => c.name === "origin")?.dflt_value).toBe(
            "'authored'",
          );
          const globalCols = db
            .prepare("PRAGMA table_info(global_apply_snapshots)")
            .all() as Array<{ name: string; dflt_value: string | null }>;
          expect(
            globalCols.find((c) => c.name === "resolved_set")?.dflt_value,
          ).toBe("'[]'");
        },
      },
      {
        label: "v24",
        setup: `
          CREATE TABLE schema_version (version INTEGER NOT NULL);
          INSERT INTO schema_version (version) VALUES (24);
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
            dirty INTEGER NOT NULL DEFAULT 0,
            frozen_at TEXT,
            overrides TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(org_slug, catalog_slug, name, version)
          );
        `,
        seed: (db) => {
          db.prepare(
            `INSERT INTO layers (
              id, name, version, org_slug, catalog_slug, description, tags,
              claude_config, needs_config, created_at, updated_at
            ) VALUES ('local', 'mine', '1.0.0', '', '', '', '[]', '{}', '[]', ?, ?)`,
          ).run(now, now);
          db.prepare(
            `INSERT INTO layers (
              id, name, version, org_slug, catalog_slug, description, tags,
              claude_config, needs_config, created_at, updated_at
            ) VALUES ('catalog', 'acme-base', '1.0.0', 'acme', 'team', '', '[]', '{}', '[]', ?, ?)`,
          ).run(now, now);
        },
        assert: (db) => {
          expect(
            (
              db
                .prepare("SELECT origin FROM plugins WHERE id = 'local'")
                .get() as { origin: string }
            ).origin,
          ).toBe("authored");
          expect(
            (
              db
                .prepare("SELECT origin FROM plugins WHERE id = 'catalog'")
                .get() as { origin: string }
            ).origin,
          ).toBe("catalog");
        },
      },
    ];

    for (const fixture of fixtures) {
      const context = await createTestContext(
        `schema-upgrade-from-${fixture.label}`,
      );
      try {
        const db = context.connection.getDb();
        db.exec(fixture.setup);
        fixture.seed?.(db);
        context.schema.initializeSchema(db);

        const version = (
          db.prepare("SELECT version FROM schema_version LIMIT 1").get() as {
            version: number;
          }
        ).version;
        expect(version).toBe(30);
        fixture.assert(db);
      } finally {
        await context.cleanup();
      }
    }
  });

  it("upgrades schema v28 with plugin origin columns", async () => {
    const context = await createTestContext("schema-upgrade-v29");

    try {
      const db = context.connection.getDb();
      db.exec(`
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (28);
        CREATE TABLE plugins (id TEXT PRIMARY KEY);
      `);
      db.prepare("INSERT INTO plugins (id) VALUES (?)").run("plugin");

      context.schema.initializeSchema(db);

      const version = (
        db.prepare("SELECT version FROM schema_version LIMIT 1").get() as {
          version: number;
        }
      ).version;
      expect(version).toBe(30);

      const pluginColumns = db
        .prepare("PRAGMA table_info(plugins)")
        .all() as Array<{ name: string }>;
      expect(pluginColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "origin_locator",
          "origin_fingerprint",
          "origin_fingerprint_kind",
        ]),
      );
      expect(
        db.prepare("SELECT id FROM plugins WHERE id = 'plugin'").get(),
      ).toEqual({ id: "plugin" });
    } finally {
      await context.cleanup();
    }
  });

  it("upgrades schema v29 with resource_materializations table", async () => {
    const context = await createTestContext("schema-upgrade-v30");

    try {
      const db = context.connection.getDb();
      const now = new Date().toISOString();
      db.exec(`
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (29);
        CREATE TABLE resources (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          metadata TEXT NOT NULL DEFAULT '{}',
          source TEXT NOT NULL DEFAULT 'manual',
          namespace TEXT NOT NULL DEFAULT '',
          origin_kind TEXT NOT NULL DEFAULT 'manual',
          origin_ref TEXT NOT NULL DEFAULT '',
          content_hash TEXT NOT NULL DEFAULT '',
          content_blob_ref TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          git_origin TEXT NOT NULL DEFAULT '',
          local_id TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL DEFAULT '',
          local_path TEXT NOT NULL DEFAULT '',
          tracked_at TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
      `);
      db.prepare(
        `INSERT INTO resources (
          id, type, name, description, content, metadata, source, namespace,
          origin_kind, origin_ref, content_hash, content_blob_ref, created_at, updated_at
        ) VALUES (?, 'skill', 'ship', '', '# Ship', '{}', 'manual', '', 'manual', '', '', '', ?, ?)`,
      ).run("resource-1", now, now);

      context.schema.initializeSchema(db);

      const version = (
        db.prepare("SELECT version FROM schema_version LIMIT 1").get() as {
          version: number;
        }
      ).version;
      expect(version).toBe(30);

      const columns = db
        .prepare("PRAGMA table_info(resource_materializations)")
        .all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "resource_id",
          "scope",
          "project_id",
          "root_path",
          "platform_id",
          "path",
          "action",
          "ownership_key",
          "generated_hash",
          "managed_container",
        ]),
      );

      db.prepare(
        `INSERT INTO resource_materializations (
          id, resource_id, scope, project_id, root_path, platform_id, path,
          action, ownership_key, generated_hash, managed_container, created_at, updated_at
        ) VALUES (?, ?, 'global', NULL, '/home/user', 'cursor', '.cursor/skills/ship/SKILL.md',
          'delete-directory', 'skill:ship', 'hash', 0, ?, ?)`,
      ).run("mat-1", "resource-1", now, now);

      expect(
        db
          .prepare("SELECT id FROM resource_materializations WHERE resource_id = 'resource-1'")
          .get(),
      ).toEqual({ id: "mat-1" });
    } finally {
      await context.cleanup();
    }
  });

  it("rejects incompatible schema versions (legacy and newer)", async () => {
    const cases = [
      {
        label: "legacy",
        version: 18,
        pattern: /cannot be upgraded in place/,
      },
      {
        label: "newer",
        version: 99,
        pattern: /newer than this binary|schema v99/,
      },
    ] as const;

    for (const testCase of cases) {
      const context = await createTestContext(
        `schema-incompatible-${testCase.label}`,
      );
      try {
        const db = context.connection.getDb();
        db.exec(`
          CREATE TABLE schema_version (version INTEGER NOT NULL);
          INSERT INTO schema_version (version) VALUES (${testCase.version});
        `);

        expect(() => context.schema.initializeSchema(db)).toThrow(
          testCase.pattern,
        );

        const versionRow = db
          .prepare("SELECT version FROM schema_version LIMIT 1")
          .get() as { version: number };
        expect(versionRow.version).toBe(testCase.version);
      } finally {
        await context.cleanup();
      }
    }
  });

  it("upgrades schema v28 with plugin origin columns", async () => {
    const context = await createTestContext("schema-upgrade-v29");

    try {
      const db = context.connection.getDb();
      db.exec(`
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (28);
        CREATE TABLE plugins (id TEXT PRIMARY KEY);
      `);
      db.prepare("INSERT INTO plugins (id) VALUES (?)").run("plugin");

      context.schema.initializeSchema(db);

      const version = (
        db.prepare("SELECT version FROM schema_version LIMIT 1").get() as {
          version: number;
        }
      ).version;
      expect(version).toBe(30);

      const pluginColumns = db
        .prepare("PRAGMA table_info(plugins)")
        .all() as Array<{ name: string }>;
      expect(pluginColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "origin_locator",
          "origin_fingerprint",
          "origin_fingerprint_kind",
        ]),
      );
      expect(
        db.prepare("SELECT id FROM plugins WHERE id = 'plugin'").get(),
      ).toEqual({ id: "plugin" });
    } finally {
      await context.cleanup();
    }
  });

});
