import { describe, expect, it } from "vitest";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("preset model", () => {
  it("creates and lists presets", async () => {
    const context = await createInitializedTestContext("preset-list");

    try {
      const presetModel = await import("../../src/models/preset.ts");

      const regular = presetModel.createPreset({
        name: "default",
        description: "Default preset",
        tags: ["core"],
      });
      const starter = presetModel.createPreset({
        name: "starter",
      });

      expect(presetModel.getPreset(regular.id)?.name).toBe("default");
      expect(starter.name).toBe("starter");
      expect(presetModel.getPreset("starter")?.name).toBe("starter");
      expect(presetModel.listPresets().map((preset) => preset.name)).toEqual([
        "default",
        "starter",
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("associates resources in insertion order and ignores duplicates", async () => {
    const context = await createInitializedTestContext("preset-resources");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      const preset = presetModel.createPreset({ name: "bundle" });
      const first = resourceModel.createResource(
        makeResourceInput({ name: "first-skill" }),
      );
      const second = resourceModel.createResource(
        makeResourceInput({ type: "rule", name: "second-rule" }),
      );

      presetModel.addResourceToPreset(preset.id, first.id);
      presetModel.addResourceToPreset(preset.id, second.id);
      presetModel.addResourceToPreset(preset.id, first.id);

      expect(
        presetModel.getPresetResources(preset.id).map((resource) => resource.id),
      ).toEqual([first.id, second.id]);

      presetModel.removeResourceFromPreset(preset.id, first.id);

      expect(
        presetModel.getPresetResources(preset.id).map((resource) => resource.id),
      ).toEqual([second.id]);
      expect(presetModel.deletePreset(preset.id)).toBe(true);
      expect(presetModel.deletePreset(preset.id)).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("returns undefined for non-existent preset", async () => {
    const context = await createInitializedTestContext("preset-not-found");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      expect(presetModel.getPreset("non-existent-id")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("returns empty list when no presets exist", async () => {
    const context = await createInitializedTestContext("preset-empty");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      expect(presetModel.listPresets()).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("returns empty resource list for preset with no resources", async () => {
    const context = await createInitializedTestContext("preset-no-resources");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const preset = presetModel.createPreset({ name: "empty" });

      expect(presetModel.getPresetResources(preset.id)).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });
});
