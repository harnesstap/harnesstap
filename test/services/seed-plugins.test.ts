import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import {
  makeMultiPluginExport,
  writePluginExportToml,
} from "../helpers/transport-fixtures.ts";

const BUILTIN_FIXTURE_DIR = join(import.meta.dirname, "../fixtures/builtin-plugins");

describe("seed plugins service", () => {
  it("seeds built-in plugins from the builtin-plugins directory", async () => {
    const context = await createInitializedTestContext("seed-plugins");
    const previousDir = process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR;
    process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR = BUILTIN_FIXTURE_DIR;

    try {
      const seedPlugins = await import("../../src/services/seed-plugins.ts");
      const pluginModel = await import("../../src/models/plugin-model.ts");

      const count = seedPlugins.seedBuiltInPlugins();

      expect(count).toBeGreaterThan(0);

      const plugins = pluginModel.listPlugins();
      const names = plugins.map((p) => p.name);
      expect(names).toContain("demo-stack");
      expect(names).toContain("demo-api");
    } finally {
      process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR = previousDir;
      await context.cleanup();
    }
  });

  it("skips already-existing plugins", async () => {
    const context = await createInitializedTestContext("seed-duplicate");
    const previousDir = process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR;
    process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR = BUILTIN_FIXTURE_DIR;

    try {
      const seedPlugins = await import("../../src/services/seed-plugins.ts");
      const pluginModel = await import("../../src/models/plugin-model.ts");

      // First seed
      seedPlugins.seedBuiltInPlugins();
      const count1 = pluginModel.listPlugins().length;

      // Second seed - should skip existing
      seedPlugins.seedBuiltInPlugins();
      const count2 = pluginModel.listPlugins().length;

      expect(count1).toBe(count2);
    } finally {
      process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR = previousDir;
      await context.cleanup();
    }
  });

  it("creates plugins with resources from bundled JSON", async () => {
    const context = await createInitializedTestContext("seed-with-resources");
    const previousDir = process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR;
    process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR = BUILTIN_FIXTURE_DIR;

    try {
      const seedPlugins = await import("../../src/services/seed-plugins.ts");
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      // Remove existing plugins
      for (const p of [...pluginModel.listPlugins()]) {
        pluginModel.deletePlugin(p.id);
      }

      const count = seedPlugins.seedBuiltInPlugins();

      expect(count).toBeGreaterThan(0);

      const demoStack = pluginModel.getPlugin("demo-stack");
      expect(demoStack).toBeDefined();
      expect(demoStack?.description).toContain("Demo web stack");
      expect(resourceModel.listResources({ source: "builtin:" })).toHaveLength(5);
    } finally {
      process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR = previousDir;
      await context.cleanup();
    }
  });

  it("sets source to builtin:filename for seeded resources", async () => {
    const context = await createInitializedTestContext("seed-source");
    const previousDir = process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR;
    process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR = BUILTIN_FIXTURE_DIR;

    try {
      const seedPlugins = await import("../../src/services/seed-plugins.ts");
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      // Remove existing plugins
      for (const p of [...pluginModel.listPlugins()]) {
        pluginModel.deletePlugin(p.id);
      }

      seedPlugins.seedBuiltInPlugins();

      const builtinResources = resourceModel.listResources({ source: "builtin:" });
      expect(builtinResources.length).toBeGreaterThan(0);
      expect(builtinResources[0]?.source).toMatch(/^builtin:/);
    } finally {
      process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR = previousDir;
      await context.cleanup();
    }
  });

  it("seeds multi-plugin built-in bundles without regex name sniffing", async () => {
    const context = await createInitializedTestContext("seed-multi-builtin-bundle");

    try {
      const builtinDir = join(context.projectDir, "builtin-plugins");
      mkdirSync(builtinDir, { recursive: true });
      const originalBuiltinDir = process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR;
      try {
        process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR = builtinDir;
        writePluginExportToml(
          join(builtinDir, "multi.harnesstap.toml"),
          makeMultiPluginExport([
            { name: "multi-one", version: "1.0.0" },
            { name: "multi-two", version: "1.0.0" },
          ]),
        );

        const seedPlugins = await import("../../src/services/seed-plugins.ts");
        const pluginModel = await import("../../src/models/plugin-model.ts");

        const before = new Set(pluginModel.listPlugins().map((plugin) => plugin.name));
        const seededCount = seedPlugins.seedBuiltInPlugins();
        const after = pluginModel.listPlugins().map((plugin) => plugin.name);

        expect(seededCount).toBeGreaterThan(0);
        expect(pluginModel.getPlugin("multi-one")).toBeDefined();
        expect(pluginModel.getPlugin("multi-two")).toBeDefined();
        expect(before.has("multi-one")).toBe(false);
        expect(before.has("multi-two")).toBe(false);
        expect(after).toContain("multi-one");
        expect(after).toContain("multi-two");
        expect(seedPlugins.seedBuiltInPlugins()).toBe(0);
      } finally {
        if (originalBuiltinDir === undefined) {
          delete process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR;
        } else {
          process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR = originalBuiltinDir;
        }
      }
    } finally {
      await context.cleanup();
    }
  });

  it("seeds missing plugins from a partially installed multi-plugin built-in bundle", async () => {
    const context = await createInitializedTestContext("seed-partial-multi-builtin-bundle");

    try {
      const builtinDir = join(context.projectDir, "builtin-plugins");
      mkdirSync(builtinDir, { recursive: true });
      const originalBuiltinDir = process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR;
      try {
        process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR = builtinDir;
        writePluginExportToml(
          join(builtinDir, "partial.harnesstap.toml"),
          makeMultiPluginExport([
            { name: "partial-one", version: "1.0.0" },
            { name: "partial-two", version: "1.0.0" },
          ]),
        );

        const seedPlugins = await import("../../src/services/seed-plugins.ts");
        const pluginModel = await import("../../src/models/plugin-model.ts");

        pluginModel.createPlugin({ name: "partial-one", version: "1.0.0" });

        const seededCount = seedPlugins.seedBuiltInPlugins();

        expect(seededCount).toBe(1);
        expect(pluginModel.getPlugin("partial-one@1.0.0")).toBeDefined();
        expect(pluginModel.getPlugin("partial-two@1.0.0")).toBeDefined();
      } finally {
        if (originalBuiltinDir === undefined) {
          delete process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR;
        } else {
          process.env.HARNESSTAP_BUILTIN_PLUGINS_DIR = originalBuiltinDir;
        }
      }
    } finally {
      await context.cleanup();
    }
  });
});
