import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { getDb } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext("migrate27-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function tableNames(): string[] {
  const db = getDb();
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

describe("migration 27", () => {
  it("renames layers to plugins and layer_resources to plugin_resources", () => {
    const db = getDb();
    initializeSchema(db);
    const names = tableNames();
    expect(names).toContain("plugins");
    expect(names).toContain("plugin_resources");
    expect(names).toContain("plugin_publish_targets");
    expect(names).toContain("project_plugins");
    expect(names).not.toContain("layers");
    expect(names).not.toContain("layer_resources");
    expect(names).not.toContain("layer_publish_targets");
    expect(names).not.toContain("project_layers");

    const fks = db
      .prepare("PRAGMA foreign_key_list(plugin_resources)")
      .all() as Array<{ table: string; from: string; to: string }>;
    const pluginFk = fks.find((fk) => fk.from === "plugin_id");
    expect(pluginFk?.table).toBe("plugins");
    expect(pluginFk?.to).toBe("id");

    const publishColumns = (
      db.prepare("PRAGMA table_info(plugin_publish_targets)").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    expect(publishColumns).toContain("plugin_id");
    expect(publishColumns).not.toContain("layer_id");

    const projectColumns = (
      db.prepare("PRAGMA table_info(project_plugins)").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    expect(projectColumns).toContain("plugin_id");
    expect(projectColumns).not.toContain("layer_id");
  });

  it("renames the working-snapshot table and its column", () => {
    const db = getDb();
    initializeSchema(db);
    expect(tableNames()).toContain("plugin_working_snapshots");
    const columns = (
      db.prepare("PRAGMA table_info(plugin_working_snapshots)").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    expect(columns).toContain("plugin_id");
    expect(columns).not.toContain("layer_id");
  });

  it("renames global_apply_snapshots.layer_ids to plugin_ids", () => {
    const db = getDb();
    initializeSchema(db);
    const columns = (
      db.prepare("PRAGMA table_info(global_apply_snapshots)").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    expect(columns).toContain("plugin_ids");
    expect(columns).not.toContain("layer_ids");
  });

  it("preserves rows across the rename", () => {
    const db = getDb();
    initializeSchema(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO plugins (id, name, version, org_slug, catalog_slug, description, tags,
        claude_config, needs_config, default_environment_id, dirty, frozen_at, overrides, origin, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "P1",
      "base",
      "1.0.0",
      "",
      "",
      "",
      "[]",
      "{}",
      "[]",
      null,
      0,
      null,
      "{}",
      "authored",
      now,
      now,
    );
    const row = db.prepare("SELECT name FROM plugins WHERE id = 'P1'").get() as {
      name: string;
    };
    expect(row.name).toBe("base");
  });
});
