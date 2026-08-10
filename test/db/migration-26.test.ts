import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { getDb } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext("migrate26-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function bootstrapSchemaVersion25(db: ReturnType<typeof getDb>): void {
  const now = new Date().toISOString();
  db.exec(`
    CREATE TABLE resources (
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

    CREATE UNIQUE INDEX idx_resources_type_name_namespace
      ON resources(type, name, namespace);

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

    CREATE TABLE layer_resources (
      layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
      resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (layer_id, resource_id)
    );

    CREATE TABLE schema_version (
      version INTEGER NOT NULL
    );

    INSERT INTO schema_version (version) VALUES (25);
  `);

  db.prepare(
    `INSERT INTO layers (id, name, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("L1", "root", "1.0.0", now, now);
}

describe("migration 26", () => {
  it("converts plugin_pin and layer resources into plugin dependencies", () => {
    const db = getDb();
    initializeSchema(db);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO resources (id, type, name, description, content, metadata, source, namespace, origin_kind, origin_ref, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "R1",
      "plugin",
      "web-search",
      "",
      "{}",
      JSON.stringify({ source_kind: "marketplace", version_constraint: "^1.0.0" }),
      "composition:plugin",
      "anthropics",
      "marketplace_link",
      "web-search@anthropics",
      now,
      now,
    );

    const row = db
      .prepare("SELECT type, metadata FROM resources WHERE id = 'R1'")
      .get() as { type: string; metadata: string };
    expect(row.type).toBe("plugin");
    expect(JSON.parse(row.metadata).source_kind).toBe("marketplace");
  });

  it("no longer accepts the plugin_pin type", () => {
    const db = getDb();
    initializeSchema(db);
    const now = new Date().toISOString();
    expect(() =>
      db
        .prepare(
          `INSERT INTO resources (id, type, name, description, content, metadata, source, namespace, origin_kind, origin_ref, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run("R2", "plugin_pin", "x", "", "{}", "{}", "s", "", "manual", "", now, now),
    ).toThrow();
  });

  it("dedupes colliding plugin_pin and layer with the same name, preferring the pin", () => {
    const db = getDb();
    bootstrapSchemaVersion25(db);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO resources (id, type, name, description, content, metadata, source, namespace, origin_kind, origin_ref, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "PIN1",
      "plugin_pin",
      "base",
      "",
      "{}",
      JSON.stringify({
        source_kind: "marketplace",
        version_constraint: "^1.0.0",
        marketplace_name: "acme",
      }),
      "composition:plugin_pin",
      "",
      "marketplace_link",
      "base@acme",
      now,
      now,
    );
    db.prepare(
      `INSERT INTO resources (id, type, name, description, content, metadata, source, namespace, origin_kind, origin_ref, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "LAYER1",
      "layer",
      "base",
      "",
      "{}",
      JSON.stringify({ version_constraint: "^2.0.0" }),
      "composition:layer",
      "",
      "manual",
      "base",
      now,
      now,
    );
    db.prepare(
      `INSERT INTO layer_resources (layer_id, resource_id, "order") VALUES (?, ?, ?)`,
    ).run("L1", "LAYER1", 0);
    db.prepare(
      `INSERT INTO layer_resources (layer_id, resource_id, "order") VALUES (?, ?, ?)`,
    ).run("L1", "PIN1", 1);

    initializeSchema(db);

    const plugins = db
      .prepare("SELECT id, type, name FROM resources WHERE name = 'base' ORDER BY id")
      .all() as Array<{ id: string; type: string; name: string }>;
    expect(plugins).toEqual([{ id: "PIN1", type: "plugin", name: "base" }]);

    const attachments = db
      .prepare(
        `SELECT resource_id FROM plugin_resources WHERE plugin_id = 'L1' ORDER BY "order"`,
      )
      .all() as Array<{ resource_id: string }>;
    expect(attachments.map((row) => row.resource_id)).toEqual(["PIN1"]);

    const pinMeta = db
      .prepare("SELECT metadata, source FROM resources WHERE id = 'PIN1'")
      .get() as { metadata: string; source: string };
    expect(pinMeta.source).toBe("composition:plugin");
    expect(JSON.parse(pinMeta.metadata).source_kind).toBe("marketplace");
  });
});
