import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";

describe("migrateToUnifiedLayers", () => {
  it("merges multi-plugin configured layers and preserves project/deck links", async () => {
    const context = await createTestContext("migrate-unified-layers");

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
          namespace TEXT NOT NULL DEFAULT '',
          origin_kind TEXT NOT NULL DEFAULT 'manual',
          origin_ref TEXT NOT NULL DEFAULT '',
          content_hash TEXT NOT NULL DEFAULT '',
          content_blob_ref TEXT NOT NULL DEFAULT '',
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
        CREATE TABLE configured_layers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          version TEXT NOT NULL DEFAULT '1.0.0',
          description TEXT NOT NULL DEFAULT '',
          default_environment_id TEXT,
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
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          git_origin TEXT NOT NULL DEFAULT '',
          local_id TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL DEFAULT '',
          local_path TEXT NOT NULL DEFAULT '',
          tracked_at TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE TABLE project_configured_layers (
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          configured_layer_id TEXT NOT NULL REFERENCES configured_layers(id) ON DELETE CASCADE,
          platforms TEXT NOT NULL DEFAULT '[]',
          applied_at TEXT NOT NULL,
          PRIMARY KEY (project_id, configured_layer_id)
        );
        CREATE TABLE decks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          root_path TEXT NOT NULL DEFAULT '',
          active_environment_id TEXT,
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
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (14);
      `);

      db.prepare(
        `INSERT INTO resources (id, type, name, description, content, metadata, source, created_at, updated_at)
         VALUES ('r1', 'instruction', 'guide-a', '', '# A', '{}', 'manual', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO resources (id, type, name, description, content, metadata, source, created_at, updated_at)
         VALUES ('r2', 'instruction', 'guide-b', '', '# B', '{}', 'manual', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO plugins (id, name, version, description, tags, claude_config, needs_config, created_at, updated_at)
         VALUES ('p1', 'pagerduty', '1.0.0', '', '[]', '{}', '[]', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO plugins (id, name, version, description, tags, claude_config, needs_config, created_at, updated_at)
         VALUES ('p2', 'slack', '1.0.0', '', '[]', '{}', '[]', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO plugin_resources (layer_id, resource_id, "order") VALUES ('p1', 'r1', 0)`,
      ).run();
      db.prepare(
        `INSERT INTO plugin_resources (layer_id, resource_id, "order") VALUES ('p2', 'r2', 0)`,
      ).run();
      db.prepare(
        `INSERT INTO configured_layers (id, name, version, description, created_at, updated_at)
         VALUES ('cl-1', 'backend-oncall', '1.0.0', '', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO configured_layer_plugins (configured_layer_id, plugin_id, "order")
         VALUES ('cl-1', 'p1', 0), ('cl-1', 'p2', 1)`,
      ).run();
      db.prepare(
        `INSERT INTO projects (id, git_origin, name, local_path, created_at)
         VALUES ('proj-1', 'git@github.com:acme/app.git', 'app', '/tmp/app', ?)`,
      ).run(now);
      db.prepare(
        `INSERT INTO project_configured_layers (project_id, configured_layer_id, platforms, applied_at)
         VALUES ('proj-1', 'cl-1', '["claude-code"]', ?)`,
      ).run(now);
      db.prepare(
        `INSERT INTO decks (id, name, root_path, created_at, updated_at)
         VALUES ('deck-1', 'team-deck', '', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO deck_configured_layers (deck_id, configured_layer_id, "order")
         VALUES ('deck-1', 'cl-1', 0)`,
      ).run();

      context.schema.initializeSchema(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const names = tables.map((table) => table.name);
      expect(names).toContain("layers");
      expect(names).toContain("layer_resources");
      expect(names).not.toContain("plugins");
      expect(names).not.toContain("configured_layers");

      const mergedResources = db
        .prepare(
          `SELECT r.name
           FROM layer_resources lr
           INNER JOIN resources r ON r.id = lr.resource_id
           WHERE lr.layer_id = 'cl-1'
           ORDER BY lr."order"`,
        )
        .all() as Array<{ name: string }>;
      expect(mergedResources.map((row) => row.name)).toEqual(["guide-a", "guide-b"]);

      const projectLink = db
        .prepare("SELECT layer_id FROM project_layers WHERE project_id = 'proj-1'")
        .get() as { layer_id: string };
      expect(projectLink.layer_id).toBe("cl-1");

      const deckLink = db
        .prepare("SELECT layer_id FROM deck_layers WHERE deck_id = 'deck-1'")
        .get() as { layer_id: string };
      expect(deckLink.layer_id).toBe("cl-1");

      const versionRow = db
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number };
      expect(versionRow.version).toBe(18);
    } finally {
      await context.cleanup();
    }
  });
});
