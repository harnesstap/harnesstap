import { describe, expect, it } from "bun:test";
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
      expect(
        Date.parse(updated?.updated_at ?? ""),
      ).toBeGreaterThanOrEqual(Date.parse(alpha.updated_at));

      expect(model.deleteResource(alpha.id)).toBe(true);
      expect(model.deleteResource(alpha.id)).toBe(false);
      expect(model.listResources()).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });

  it("returns undefined for non-existent resource", async () => {
    const context = await createInitializedTestContext("resource-not-found");

    try {
      const model = await import("../../src/models/resource.ts");
      expect(model.getResource("non-existent-id")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("updates resource with partial fields", async () => {
    const context = await createInitializedTestContext("resource-partial-update");

    try {
      const model = await import("../../src/models/resource.ts");
      const resource = model.createResource(
        makeResourceInput({ name: "full", description: "Full desc", content: "Full content" }),
      );

      const updated = model.updateResource(resource.id, { name: "partial" });

      expect(updated?.name).toBe("partial");
      expect(updated?.description).toBe("Full desc");
      expect(updated?.content).toBe("Full content");
    } finally {
      await context.cleanup();
    }
  });

  it("returns undefined when updating non-existent resource", async () => {
    const context = await createInitializedTestContext("resource-update-missing");

    try {
      const model = await import("../../src/models/resource.ts");
      expect(model.updateResource("non-existent", { name: "x" })).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("lists all resources with no filters", async () => {
    const context = await createInitializedTestContext("resource-list-all");

    try {
      const model = await import("../../src/models/resource.ts");
      model.createResource(makeResourceInput({ type: "skill", name: "a" }));
      model.createResource(makeResourceInput({ type: "rule", name: "b" }));
      model.createResource(makeResourceInput({ type: "instruction", name: "c" }));

      expect(model.listResources()).toHaveLength(3);
    } finally {
      await context.cleanup();
    }
  });

  it("returns empty list when no resources exist", async () => {
    const context = await createInitializedTestContext("resource-empty");

    try {
      const model = await import("../../src/models/resource.ts");
      expect(model.listResources()).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("returns false when deleting non-existent resource", async () => {
    const context = await createInitializedTestContext("resource-delete-missing");

    try {
      const model = await import("../../src/models/resource.ts");
      expect(model.deleteResource("non-existent-id")).toBe(false);
    } finally {
      await context.cleanup();
    }
  });
});
