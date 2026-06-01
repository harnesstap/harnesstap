import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

describe("seed layers service", () => {
  it("seeds built-in layers from the builtin-layers directory", async () => {
    const context = await createInitializedTestContext("seed-layers");

    try {
      const seedLayers = await import("../../src/services/seed-layers.ts");
      const layerModel = await import("../../src/models/layer.ts");

      const count = seedLayers.seedBuiltInLayers();

      expect(count).toBeGreaterThan(0);

      const layers = layerModel.listLayers();
      const names = layers.map((p) => p.name);
      expect(names).toContain("nextjs-fullstack");
      expect(names).toContain("python-fastapi");
    } finally {
      await context.cleanup();
    }
  });

  it("skips already-existing layers", async () => {
    const context = await createInitializedTestContext("seed-duplicate");

    try {
      const seedLayers = await import("../../src/services/seed-layers.ts");
      const layerModel = await import("../../src/models/layer.ts");

      // First seed
      seedLayers.seedBuiltInLayers();
      const count1 = layerModel.listLayers().length;

      // Second seed - should skip existing
      seedLayers.seedBuiltInLayers();
      const count2 = layerModel.listLayers().length;

      expect(count1).toBe(count2);
    } finally {
      await context.cleanup();
    }
  });

  it("creates layers with resources from bundled JSON", async () => {
    const context = await createInitializedTestContext("seed-with-resources");

    try {
      const seedLayers = await import("../../src/services/seed-layers.ts");
      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      // Remove existing layers
      for (const p of [...layerModel.listLayers()]) {
        layerModel.deleteLayer(p.id);
      }

      const count = seedLayers.seedBuiltInLayers();

      expect(count).toBeGreaterThan(0);

      const nextjs = layerModel.getLayer("nextjs-fullstack");
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
      const seedLayers = await import("../../src/services/seed-layers.ts");
      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      // Remove existing layers
      for (const p of [...layerModel.listLayers()]) {
        layerModel.deleteLayer(p.id);
      }

      seedLayers.seedBuiltInLayers();

      const builtinResources = resourceModel.listResources({ source: "builtin:" });
      expect(builtinResources.length).toBeGreaterThan(0);
      expect(builtinResources[0]?.source).toMatch(/^builtin:/);
    } finally {
      await context.cleanup();
    }
  });

  it("seeds multi-layer built-in bundles without regex name sniffing", async () => {
    const context = await createInitializedTestContext("seed-multi-builtin-bundle");

    try {
      const builtinDir = join(context.projectDir, "builtin-layers");
      mkdirSync(builtinDir, { recursive: true });
      const originalBuiltinDir = process.env.HARNESSDECK_BUILTIN_LAYERS_DIR;
      try {
        process.env.HARNESSDECK_BUILTIN_LAYERS_DIR = builtinDir;
        writeTextFile(
          join(builtinDir, "multi.jsonc"),
          `{
  "$schema": "urn:harnessdeck:bundle:v1",
  "version": 1,
  "layers": [
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

        const seedLayers = await import("../../src/services/seed-layers.ts");
        const layerModel = await import("../../src/models/layer.ts");

        const before = new Set(layerModel.listLayers().map((layer) => layer.name));
        const seededCount = seedLayers.seedBuiltInLayers();
        const after = layerModel.listLayers().map((layer) => layer.name);

        expect(seededCount).toBeGreaterThan(0);
        expect(layerModel.getLayer("multi-one")).toBeDefined();
        expect(layerModel.getLayer("multi-two")).toBeDefined();
        expect(before.has("multi-one")).toBe(false);
        expect(before.has("multi-two")).toBe(false);
        expect(after).toContain("multi-one");
        expect(after).toContain("multi-two");
        expect(seedLayers.seedBuiltInLayers()).toBe(0);
      } finally {
        if (originalBuiltinDir === undefined) {
          delete process.env.HARNESSDECK_BUILTIN_LAYERS_DIR;
        } else {
          process.env.HARNESSDECK_BUILTIN_LAYERS_DIR = originalBuiltinDir;
        }
      }
    } finally {
      await context.cleanup();
    }
  });

  it("seeds missing layers from a partially installed multi-layer built-in bundle", async () => {
    const context = await createInitializedTestContext("seed-partial-multi-builtin-bundle");

    try {
      const builtinDir = join(context.projectDir, "builtin-layers");
      mkdirSync(builtinDir, { recursive: true });
      const originalBuiltinDir = process.env.HARNESSDECK_BUILTIN_LAYERS_DIR;
      try {
        process.env.HARNESSDECK_BUILTIN_LAYERS_DIR = builtinDir;
        writeTextFile(
          join(builtinDir, "partial.jsonc"),
          `{
  "$schema": "urn:harnessdeck:bundle:v1",
  "version": 1,
  "layers": [
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

        const seedLayers = await import("../../src/services/seed-layers.ts");
        const layerModel = await import("../../src/models/layer.ts");

        layerModel.createLayer({ name: "partial-one", version: "1.0.0" });

        const seededCount = seedLayers.seedBuiltInLayers();

        expect(seededCount).toBe(1);
        expect(layerModel.getLayer("partial-one@1.0.0")).toBeDefined();
        expect(layerModel.getLayer("partial-two@1.0.0")).toBeDefined();
      } finally {
        if (originalBuiltinDir === undefined) {
          delete process.env.HARNESSDECK_BUILTIN_LAYERS_DIR;
        } else {
          process.env.HARNESSDECK_BUILTIN_LAYERS_DIR = originalBuiltinDir;
        }
      }
    } finally {
      await context.cleanup();
    }
  });
});
