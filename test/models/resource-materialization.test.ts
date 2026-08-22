import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { createResource } from "../../src/models/resource.ts";
import {
  deleteResourceMaterializations,
  listResourceMaterializations,
  recordResourceMaterialization,
} from "../../src/models/resource-materialization.ts";

describe("resource materializations", () => {
  it("records, lists, upserts, and deletes ownership rows", async () => {
    const context = await createTestContext("resource-materialization-crud");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const resource = createResource({
        type: "skill",
        name: "ship",
        description: "",
        content: "# Ship",
        metadata: {},
        source: "manual",
      });

      const first = recordResourceMaterialization({
        resource_id: resource.id,
        scope: "global",
        root_path: "/home/user",
        platform_id: "cursor",
        path: ".cursor/skills/ship/SKILL.md",
        action: "delete-directory",
        ownership_key: "skill:ship",
        generated_hash: "abc123",
        managed_container: true,
      });

      expect(first.resource_id).toBe(resource.id);
      expect(first.managed_container).toBe(true);
      expect(listResourceMaterializations(resource.id)).toEqual([first]);

      const updated = recordResourceMaterialization({
        resource_id: resource.id,
        scope: "global",
        root_path: "/home/user",
        platform_id: "cursor",
        path: ".cursor/skills/ship/SKILL.md",
        action: "delete-directory",
        ownership_key: "skill:ship",
        generated_hash: "def456",
        managed_container: false,
      });

      expect(updated.id).toBe(first.id);
      expect(updated.generated_hash).toBe("def456");
      expect(updated.managed_container).toBe(false);
      expect(listResourceMaterializations(resource.id)).toEqual([updated]);

      expect(deleteResourceMaterializations(resource.id)).toBe(1);
      expect(listResourceMaterializations(resource.id)).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("cascades when the resource is deleted", async () => {
    const context = await createTestContext("resource-materialization-cascade");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const db = context.connection.getDb();
      const resource = createResource({
        type: "skill",
        name: "cascade",
        description: "",
        content: "# Cascade",
        metadata: {},
        source: "manual",
      });

      recordResourceMaterialization({
        resource_id: resource.id,
        scope: "global",
        root_path: "/home/user",
        platform_id: "cursor",
        path: ".cursor/skills/cascade/SKILL.md",
        action: "delete-directory",
        ownership_key: "skill:cascade",
        generated_hash: "hash",
      });

      db.prepare("DELETE FROM resources WHERE id = ?").run(resource.id);

      const rows = db
        .prepare("SELECT id FROM resource_materializations WHERE resource_id = ?")
        .all(resource.id);
      expect(rows).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });
});
