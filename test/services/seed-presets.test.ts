import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

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

  it("seeds multi-preset built-in bundles without regex name sniffing", async () => {
    const context = await createInitializedTestContext("seed-multi-builtin-bundle");

    try {
      const builtinDir = join(context.projectDir, "builtin-presets");
      mkdirSync(builtinDir, { recursive: true });
      const originalBuiltinDir = process.env.HARNESSDECK_BUILTIN_PRESETS_DIR;
      try {
        process.env.HARNESSDECK_BUILTIN_PRESETS_DIR = builtinDir;
        writeTextFile(
          join(builtinDir, "multi.jsonc"),
          `{
  "$schema": "urn:harnessdeck:bundle:v1",
  "version": 1,
  "presets": [
    {
      "name": "multi-one",
      "version": "1.0.0",
      "description": "",
      "tags": [],
      "resources": [],
      "plugins": [],
    },
    {
      "name": "multi-two",
      "version": "1.0.0",
      "description": "",
      "tags": [],
      "resources": [],
      "plugins": [],
    },
  ],
  "embedded_plugins": [],
}`,
        );

        const seedPresets = await import("../../src/services/seed-presets.ts");
        const presetModel = await import("../../src/models/preset.ts");

        const before = new Set(presetModel.listPresets().map((preset) => preset.name));
        const seededCount = seedPresets.seedBuiltInPresets();
        const after = presetModel.listPresets().map((preset) => preset.name);

        expect(seededCount).toBeGreaterThan(0);
        expect(presetModel.getPreset("multi-one")).toBeDefined();
        expect(presetModel.getPreset("multi-two")).toBeDefined();
        expect(before.has("multi-one")).toBe(false);
        expect(before.has("multi-two")).toBe(false);
        expect(after).toContain("multi-one");
        expect(after).toContain("multi-two");
        expect(seedPresets.seedBuiltInPresets()).toBe(0);
      } finally {
        if (originalBuiltinDir === undefined) {
          delete process.env.HARNESSDECK_BUILTIN_PRESETS_DIR;
        } else {
          process.env.HARNESSDECK_BUILTIN_PRESETS_DIR = originalBuiltinDir;
        }
      }
    } finally {
      await context.cleanup();
    }
  });

  it("seeds missing presets from a partially installed multi-preset built-in bundle", async () => {
    const context = await createInitializedTestContext("seed-partial-multi-builtin-bundle");

    try {
      const builtinDir = join(context.projectDir, "builtin-presets");
      mkdirSync(builtinDir, { recursive: true });
      const originalBuiltinDir = process.env.HARNESSDECK_BUILTIN_PRESETS_DIR;
      try {
        process.env.HARNESSDECK_BUILTIN_PRESETS_DIR = builtinDir;
        writeTextFile(
          join(builtinDir, "partial.jsonc"),
          `{
  "$schema": "urn:harnessdeck:bundle:v1",
  "version": 1,
  "presets": [
    {
      "name": "partial-one",
      "version": "1.0.0",
      "description": "",
      "tags": [],
      "resources": [],
      "plugins": []
    },
    {
      "name": "partial-two",
      "version": "1.0.0",
      "description": "",
      "tags": [],
      "resources": [],
      "plugins": []
    }
  ],
  "embedded_plugins": []
}`,
        );

        const seedPresets = await import("../../src/services/seed-presets.ts");
        const presetModel = await import("../../src/models/preset.ts");

        presetModel.createPreset({ name: "partial-one", version: "1.0.0" });

        const seededCount = seedPresets.seedBuiltInPresets();

        expect(seededCount).toBe(1);
        expect(presetModel.getPreset("partial-one@1.0.0")).toBeDefined();
        expect(presetModel.getPreset("partial-two@1.0.0")).toBeDefined();
      } finally {
        if (originalBuiltinDir === undefined) {
          delete process.env.HARNESSDECK_BUILTIN_PRESETS_DIR;
        } else {
          process.env.HARNESSDECK_BUILTIN_PRESETS_DIR = originalBuiltinDir;
        }
      }
    } finally {
      await context.cleanup();
    }
  });
});
