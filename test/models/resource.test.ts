import { describe, expect, it } from "vitest";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("resource model", () => {
  it("creates, filters, updates, and deletes resources", async () => {
    const context = await createInitializedTestContext("resource-model");

    try {
      const model = await import("../../src/models/resource.ts");
      const alpha = model.createResource(
        makeResourceInput({
          type: "skill",
          name: "alpha",
          description: "Alpha description",
        }),
      );
      const beta = model.createResource(
        makeResourceInput({
          type: "instruction",
          name: "beta",
          description: "Beta guidance",
        }),
      );

      expect(model.getResource(alpha.id)?.metadata).toEqual({});
      expect(model.listResources()).toHaveLength(2);
      expect(model.listResources({ type: "skill" }).map((resource) => resource.id)).toEqual([
        alpha.id,
      ]);
      expect(
        model.listResources({ search: "guidance" }).map((resource) => resource.id),
      ).toEqual([beta.id]);

      const updated = model.updateResource(alpha.id, {
        name: "alpha-updated",
        metadata: { references: ["docs"] },
      });

      expect(updated?.name).toBe("alpha-updated");
      expect(updated?.metadata).toEqual({ references: ["docs"] });
      expect(updated?.updated_at).not.toBe(alpha.updated_at);

      expect(model.deleteResource(alpha.id)).toBe(true);
      expect(model.deleteResource(alpha.id)).toBe(false);
      expect(model.listResources()).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });
});
