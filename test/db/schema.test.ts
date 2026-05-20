import { describe, expect, it } from "vitest";
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
          "project_harnesses",
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

      expect(versionRow.version).toBe(3);
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

      expect(versionRows).toEqual([{ version: 3 }]);
    } finally {
      await context.cleanup();
    }
  });
});
