import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";
import {
  makeMultiLayerExport,
  writeLayerExportToml,
} from "../helpers/transport-fixtures.ts";

const BUILTIN_FIXTURE_DIR = join(import.meta.dirname, "../fixtures/builtin-plugins");

describe("seed plugins service", () => {
  it("seeds built-in plugins from the builtin-plugins directory", async () => {
    const context = await createInitializedTestContext("seed-plugins");
    const previousDir = process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR;
    process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR = BUILTIN_FIXTURE_DIR;

    try {
      const seedPlugins = await import("../../src/services/seed-plugins.ts");
      const layerModel = await import("../../src/models/layer.ts");

      const count = seedPlugins.seedBuiltInPlugins();

      expect(count).toBeGreaterThan(0);

      const layers = layerModel.listLayers();
      const names = layers.map((p) => p.name);
      expect(names).toContain("nextjs-fullstack");
      expect(names).toContain("python-fastapi");
    } finally {
      process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR = previousDir;
      await context.cleanup();
    }
  });

  it("skips already-existing layers", async () => {
    const context = await createInitializedTestContext("seed-duplicate");
    const previousDir = process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR;
    process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR = BUILTIN_FIXTURE_DIR;

    try {
      const seedPlugins = await import("../../src/services/seed-plugins.ts");
      const layerModel = await import("../../src/models/layer.ts");

      // First seed
      seedPlugins.seedBuiltInPlugins();
      const count1 = layerModel.listLayers().length;

      // Second seed - should skip existing
      seedPlugins.seedBuiltInPlugins();
      const count2 = layerModel.listLayers().length;

      expect(count1).toBe(count2);
    } finally {
      process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR = previousDir;
      await context.cleanup();
    }
  });

  it("creates layers with resources from bundled JSON", async () => {
    const context = await createInitializedTestContext("seed-with-resources");
    const previousDir = process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR;
    process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR = BUILTIN_FIXTURE_DIR;

    try {
      const seedPlugins = await import("../../src/services/seed-plugins.ts");
      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      // Remove existing layers
      for (const p of [...layerModel.listLayers()]) {
        layerModel.deleteLayer(p.id);
      }

      const count = seedPlugins.seedBuiltInPlugins();

      expect(count).toBeGreaterThan(0);

      const nextjs = layerModel.getLayer("nextjs-fullstack");
      expect(nextjs).toBeDefined();
      expect(nextjs?.description).toContain("Next.js");
      expect(resourceModel.listResources({ source: "builtin:" })).toHaveLength(5);
    } finally {
      process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR = previousDir;
      await context.cleanup();
    }
  });

  it("sets source to builtin:filename for seeded resources", async () => {
    const context = await createInitializedTestContext("seed-source");
    const previousDir = process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR;
    process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR = BUILTIN_FIXTURE_DIR;

    try {
      const seedPlugins = await import("../../src/services/seed-plugins.ts");
      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      // Remove existing layers
      for (const p of [...layerModel.listLayers()]) {
        layerModel.deleteLayer(p.id);
      }

      seedPlugins.seedBuiltInPlugins();

      const builtinResources = resourceModel.listResources({ source: "builtin:" });
      expect(builtinResources.length).toBeGreaterThan(0);
      expect(builtinResources[0]?.source).toMatch(/^builtin:/);
    } finally {
      process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR = previousDir;
      await context.cleanup();
    }
  });

  it("seeds multi-layer built-in bundles without regex name sniffing", async () => {
    const context = await createInitializedTestContext("seed-multi-builtin-bundle");

    try {
      const builtinDir = join(context.projectDir, "builtin-plugins");
      mkdirSync(builtinDir, { recursive: true });
      const originalBuiltinDir = process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR;
      try {
        process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR = builtinDir;
        writeLayerExportToml(
          join(builtinDir, "multi.harnessdeck.toml"),
          makeMultiLayerExport([
            { name: "multi-one", version: "1.0.0" },
            { name: "multi-two", version: "1.0.0" },
          ]),
        );

        const seedPlugins = await import("../../src/services/seed-plugins.ts");
        const layerModel = await import("../../src/models/layer.ts");

        const before = new Set(layerModel.listLayers().map((layer) => layer.name));
        const seededCount = seedPlugins.seedBuiltInPlugins();
        const after = layerModel.listLayers().map((layer) => layer.name);

        expect(seededCount).toBeGreaterThan(0);
        expect(layerModel.getLayer("multi-one")).toBeDefined();
        expect(layerModel.getLayer("multi-two")).toBeDefined();
        expect(before.has("multi-one")).toBe(false);
        expect(before.has("multi-two")).toBe(false);
        expect(after).toContain("multi-one");
        expect(after).toContain("multi-two");
        expect(seedPlugins.seedBuiltInPlugins()).toBe(0);
      } finally {
        if (originalBuiltinDir === undefined) {
          delete process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR;
        } else {
          process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR = originalBuiltinDir;
        }
      }
    } finally {
      await context.cleanup();
    }
  });

  it("seeds missing layers from a partially installed multi-layer built-in bundle", async () => {
    const context = await createInitializedTestContext("seed-partial-multi-builtin-bundle");

    try {
      const builtinDir = join(context.projectDir, "builtin-plugins");
      mkdirSync(builtinDir, { recursive: true });
      const originalBuiltinDir = process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR;
      try {
        process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR = builtinDir;
        writeLayerExportToml(
          join(builtinDir, "partial.harnessdeck.toml"),
          makeMultiLayerExport([
            { name: "partial-one", version: "1.0.0" },
            { name: "partial-two", version: "1.0.0" },
          ]),
        );

        const seedPlugins = await import("../../src/services/seed-plugins.ts");
        const layerModel = await import("../../src/models/layer.ts");

        layerModel.createLayer({ name: "partial-one", version: "1.0.0" });

        const seededCount = seedPlugins.seedBuiltInPlugins();

        expect(seededCount).toBe(1);
        expect(layerModel.getLayer("partial-one@1.0.0")).toBeDefined();
        expect(layerModel.getLayer("partial-two@1.0.0")).toBeDefined();
      } finally {
        if (originalBuiltinDir === undefined) {
          delete process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR;
        } else {
          process.env.HARNESSDECK_BUILTIN_PLUGINS_DIR = originalBuiltinDir;
        }
      }
    } finally {
      await context.cleanup();
    }
  });
});
