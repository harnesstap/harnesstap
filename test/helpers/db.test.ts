import { describe, expect, it } from "vitest";
import { createInitializedTestContext } from "./db.ts";

describe("test database helpers", () => {
  it("creates isolated databases under the temporary home directory", async () => {
    const first = await createInitializedTestContext("db-helper-first");

    try {
      const resourceModel = await import("../../src/models/resource.ts");
      resourceModel.createResource({
        type: "skill",
        name: "first",
        description: "First resource",
        content: "hello",
        metadata: {},
        source: "manual",
      });

      expect(first.connection.getDbPath()).toContain(first.homeDir);
      expect(resourceModel.listResources()).toHaveLength(1);
    } finally {
      await first.cleanup();
    }

    const second = await createInitializedTestContext("db-helper-second");

    try {
      const resourceModel = await import("../../src/models/resource.ts");
      expect(second.connection.getDbPath()).toContain(second.homeDir);
      expect(resourceModel.listResources()).toHaveLength(0);
    } finally {
      await second.cleanup();
    }
  });
});
