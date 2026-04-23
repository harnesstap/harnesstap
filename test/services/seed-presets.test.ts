import { describe, expect, it } from "vitest";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("seed presets service", () => {
  it("seeds built-in presets from the builtin-presets directory", async () => {
    const context = await createInitializedTestContext("seed-presets");

    try {
      const seedPresets = await import("../../src/services/seed-presets.ts");
      const presetModel = await import("../../src/models/preset.ts");

      const count = seedPresets.seedBuiltInPresets();

      expect(count).toBeGreaterThan(0);

      const presets = presetModel.listPresets();
      const names = presets.map((p) => p.name);
      expect(names).toContain("nextjs-fullstack");
      expect(names).toContain("python-fastapi");
    } finally {
      await context.cleanup();
    }
  });

  it("skips already-existing presets", async () => {
    const context = await createInitializedTestContext("seed-duplicate");

    try {
      const seedPresets = await import("../../src/services/seed-presets.ts");
      const presetModel = await import("../../src/models/preset.ts");

      // First seed
      seedPresets.seedBuiltInPresets();
      const count1 = presetModel.listPresets().length;

      // Second seed - should skip existing
      seedPresets.seedBuiltInPresets();
      const count2 = presetModel.listPresets().length;

      expect(count1).toBe(count2);
    } finally {
      await context.cleanup();
    }
  });

  it("creates presets with resources from bundled JSON", async () => {
    const context = await createInitializedTestContext("seed-with-resources");

    try {
      const seedPresets = await import("../../src/services/seed-presets.ts");
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      // Remove existing presets
      for (const p of [...presetModel.listPresets()]) {
        presetModel.deletePreset(p.id);
      }

      const count = seedPresets.seedBuiltInPresets();

      expect(count).toBeGreaterThan(0);

      const nextjs = presetModel.getPreset("nextjs-fullstack");
      expect(nextjs).toBeDefined();
      expect(nextjs?.description).toContain("Next.js");
      expect(resourceModel.listResources({ source: "builtin:" })).toHaveLength(6);
    } finally {
      await context.cleanup();
    }
  });

  it("sets source to builtin:filename for seeded resources", async () => {
    const context = await createInitializedTestContext("seed-source");

    try {
      const seedPresets = await import("../../src/services/seed-presets.ts");
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      // Remove existing presets
      for (const p of [...presetModel.listPresets()]) {
        presetModel.deletePreset(p.id);
      }

      seedPresets.seedBuiltInPresets();

      const builtinResources = resourceModel.listResources({ source: "builtin:" });
      expect(builtinResources.length).toBeGreaterThan(0);
      expect(builtinResources[0]?.source).toMatch(/^builtin:/);
    } finally {
      await context.cleanup();
    }
  });
});
