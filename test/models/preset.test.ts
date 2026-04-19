import { describe, expect, it } from "vitest";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("preset model", () => {
  it("creates presets and filters template presets", async () => {
    const context = await createInitializedTestContext("preset-list");

    try {
      const presetModel = await import("../../src/models/preset.ts");

      const regular = presetModel.createPreset({
        name: "default",
        description: "Default preset",
        tags: ["core"],
      });
      const template = presetModel.createPreset({
        name: "starter",
      });

      expect(presetModel.getPreset(regular.id)?.name).toBe("default");
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
});
