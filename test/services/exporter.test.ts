import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("exporter services", () => {
  it("exports a preset bundle without internal fields", async () => {
    const context = await createInitializedTestContext("export-bundle");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const exporter = await import("../../src/services/exporter.ts");

      const preset = presetModel.createPreset({ name: "bundle" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "shared", description: "Shared skill" }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const bundle = exporter.exportPreset(preset.id);

      expect(bundle.$schema).toBe("urn:harnessdeck:bundle:v1");
      expect(bundle.version).toBe(1);
      expect(bundle.plugins).toEqual([]);
      expect(bundle.embedded_plugins).toEqual([]);
      expect(bundle.preset.name).toBe("bundle");
      expect(bundle.resources[0]).toEqual(
        expect.not.objectContaining({ id: expect.anything(), source: expect.anything() }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("writes and re-imports bundles from disk", async () => {
    const exportContext = await createInitializedTestContext("export-import-export");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const exporter = await import("../../src/services/exporter.ts");

      const preset = presetModel.createPreset({ name: "bundle" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "shared", description: "Shared skill" }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const bundlePath = `${exportContext.projectDir}/bundle.json`;
      exporter.exportToFile(preset.id, bundlePath);

      expect(existsSync(bundlePath)).toBe(true);
      expect(JSON.parse(readFileSync(bundlePath, "utf-8"))).toEqual(
        expect.objectContaining({ version: 1 }),
      );

      const importContext = await createInitializedTestContext("export-import-import");

      try {
        const importedExporter = await import("../../src/services/exporter.ts");
        const imported = importedExporter.importFromFile(bundlePath);

        expect(imported.preset.name).toBe("bundle");
        expect(imported.resources).toHaveLength(1);
        expect(imported.resources[0]?.source).toBe(`import:${bundlePath}`);
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("writes .jsonc bundles with a leading comment block", async () => {
    const exportContext = await createInitializedTestContext("export-jsonc-comment-block");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const exporter = await import("../../src/services/exporter.ts");

      const preset = presetModel.createPreset({ name: "commented-export" });
      const bundlePath = join(exportContext.projectDir, "commented-export.jsonc");
      exporter.exportToFile(preset.id, bundlePath);

      const raw = readFileSync(bundlePath, "utf-8");
      expect(raw.startsWith("/*\n")).toBe(true);
      expect(raw).toContain('"$schema": "urn:harnessdeck:bundle:v1"');
      expect(raw).toContain(" * Source machine: ");

      const importContext = await createInitializedTestContext("import-jsonc-comment-block");
      try {
        const importedExporter = await import("../../src/services/exporter.ts");
        expect(() => importedExporter.importFromFile(bundlePath)).not.toThrow();
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("throws when exporting a non-existent preset", async () => {
    const context = await createInitializedTestContext("export-not-found");

    try {
      const exporter = await import("../../src/services/exporter.ts");

      expect(() => exporter.exportPreset("non-existent-preset")).toThrow(
        "Preset not found: non-existent-preset",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("throws when importing with unsupported bundle version", async () => {
    const context = await createInitializedTestContext("export-bad-version");

    try {
      const exporter = await import("../../src/services/exporter.ts");
      const tempDir = createTempDir("export-bad-version");

      try {
        const bundlePath = join(tempDir, "bundle.json");
        writeTextFile(bundlePath, JSON.stringify({
          $schema: "urn:harnessdeck:bundle:v1",
          version: 99,
          preset: { name: "bad-version", description: "", tags: [] },
          resources: [],
        }));

        expect(() => exporter.importFromFile(bundlePath)).toThrow(
          "Unsupported bundle version: 99",
        );
      } finally {
        require("node:fs").rmSync(tempDir, { recursive: true, force: true });
      }
    } finally {
      await context.cleanup();
    }
  });

  it("throws when importing malformed JSON", async () => {
    const context = await createInitializedTestContext("export-malformed");

    try {
      const exporter = await import("../../src/services/exporter.ts");
      const tempDir = createTempDir("export-malformed");

      try {
        const bundlePath = join(tempDir, "bundle.json");
        writeTextFile(bundlePath, "this is not json");

        expect(() => exporter.importFromFile(bundlePath)).toThrow();
      } finally {
        require("node:fs").rmSync(tempDir, { recursive: true, force: true });
      }
    } finally {
      await context.cleanup();
    }
  });

  it("throws when importing truncated JSONC that parses to a partial object", async () => {
    const context = await createInitializedTestContext("export-truncated-jsonc");

    try {
      const exporter = await import("../../src/services/exporter.ts");
      const tempDir = createTempDir("export-truncated-jsonc");

      try {
        const bundlePath = join(tempDir, "bundle.jsonc");
        writeTextFile(
          bundlePath,
          `{
  "$schema": "urn:harnessdeck:bundle:v1",
  "version": 1,
  "preset": {
    "name": "truncated-bundle",
    "description": "broken",
    "tags": []
  },
  "resources": []`,
        );

        expect(() => exporter.importFromFile(bundlePath)).toThrow();
      } finally {
        require("node:fs").rmSync(tempDir, { recursive: true, force: true });
      }
    } finally {
      await context.cleanup();
    }
  });

  it("imports a bundle file with comments and trailing commas", async () => {
    const context = await createInitializedTestContext("export-jsonc-import");

    try {
      const exporter = await import("../../src/services/exporter.ts");
      const tempDir = createTempDir("export-jsonc-import");

      try {
        const bundlePath = join(tempDir, "bundle.jsonc");
        writeTextFile(
          bundlePath,
          `{
  // comment before schema
  "$schema": "urn:harnessdeck:bundle:v1",
  "version": 1,
  "preset": {
    "name": "jsonc-bundle",
    "version": "1.2.3",
    "description": "JSONC bundle",
    "tags": ["jsonc",],
  },
  "resources": [
    {
      "type": "instruction",
      "name": "shared",
      "description": "Shared skill",
      "content": "# Shared",
      "metadata": {},
    },
  ],
  "plugins": [],
  "embedded_plugins": [],
}`,
        );

        const imported = exporter.importFromFile(bundlePath);
        expect(imported.preset.name).toBe("jsonc-bundle");
        expect(imported.preset.version).toBe("1.2.3");
        expect(imported.resources).toHaveLength(1);
        expect(imported.resources[0]?.name).toBe("shared");
      } finally {
        require("node:fs").rmSync(tempDir, { recursive: true, force: true });
      }
    } finally {
      await context.cleanup();
    }
  });

  it("bundle lists marketplace refs in plugins[], not embedded", async () => {
    const context = await createInitializedTestContext("export-bundle-plugins");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const pluginModel = await import("../../src/models/plugin.ts");
      const exporter = await import("../../src/services/exporter.ts");

      const preset = presetModel.createPreset({ name: "plugs" });
      pluginModel.addPluginToPreset(preset.id, "fmt@acme-marketplace", ">=2");

      const bundle = exporter.exportPreset(preset.id);
      expect(bundle.version).toBe(1);
      expect(bundle.plugins).toEqual([
        { ref: "fmt@acme-marketplace", version_constraint: ">=2" },
      ]);
      expect(bundle.embedded_plugins).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("bundle embeds in-repo ./ plugin paths", async () => {
    const context = await createInitializedTestContext("export-bundle-inrepo");

    try {
      const demoRoot = join(context.projectDir, "plugins/demo");
      mkdirSync(dirname(join(demoRoot, ".claude-plugin/plugin.json")), {
        recursive: true,
      });
      writeTextFile(
        join(demoRoot, ".claude-plugin/plugin.json"),
        JSON.stringify({
          version: "1.0.0",
          name: "demo",
        }),
      );
      writeTextFile(join(demoRoot, "README.md"), "hello");

      const presetModel = await import("../../src/models/preset.ts");
      const pluginModel = await import("../../src/models/plugin.ts");
      const exporter = await import("../../src/services/exporter.ts");

      const preset = presetModel.createPreset({ name: "local-plug" });
      pluginModel.addPluginToPreset(preset.id, "./plugins/demo", "1.x");

      const bundle = exporter.exportPreset(preset.id, {
        projectRoot: context.projectDir,
      });
      expect(bundle.plugins).toHaveLength(0);
      expect(bundle.embedded_plugins).toHaveLength(1);
      expect(bundle.embedded_plugins[0]?.ref).toBe("./plugins/demo");
      expect(bundle.embedded_plugins[0]?.files["README.md"]).toBe("hello");
    } finally {
      await context.cleanup();
    }
  });

  it("embedPlugins option inlines marketplace installs then round-trips pins", async () => {
    const context = await createInitializedTestContext("export-bundle-embed-market");

    try {
      const claudePlug = join(context.homeDir, ".claude", "plugins");
      mkdirSync(claudePlug, { recursive: true });
      const installRel = "cache/acme-marketplace/fmt";
      const plugRoot = join(claudePlug, installRel);
      mkdirSync(join(plugRoot, ".claude-plugin"), { recursive: true });
      writeTextFile(
        join(plugRoot, ".claude-plugin/plugin.json"),
        JSON.stringify({ version: "2.1.0" }),
      );
      writeTextFile(
        join(claudePlug, "installed_plugins.json"),
        JSON.stringify({
          plugins: {
            "fmt@acme-marketplace": [
              {
                scope: "user",
                installPath: installRel,
                version: "2.1.0",
              },
            ],
          },
        }),
      );

      const presetModel = await import("../../src/models/preset.ts");
      const pluginModel = await import("../../src/models/plugin.ts");
      const exporter = await import("../../src/services/exporter.ts");

      const preset = presetModel.createPreset({ name: "mkt-plug" });
      pluginModel.addPluginToPreset(preset.id, "fmt@acme-marketplace", "2.x");

      const bundle = exporter.exportPreset(preset.id, {
        embedPlugins: true,
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
      });
      expect(bundle.plugins).toHaveLength(0);
      expect(bundle.embedded_plugins).toHaveLength(1);
      expect(bundle.embedded_plugins[0]?.ref).toBe("fmt@acme-marketplace");

      const bundlePath = join(context.projectDir, "embedded.json");
      exporter.exportToFile(preset.id, bundlePath, {
        embedPlugins: true,
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
      });

      presetModel.deletePreset(preset.id);
      const unpack = join(context.projectDir, "unpacked-plugins");
      mkdirSync(unpack, { recursive: true });

      const imported = exporter.importFromFile(bundlePath, {
        embeddedTargetDir: unpack,
      });
      const pluginModelFresh = await import("../../src/models/plugin.ts");
      const presetModelFresh = await import("../../src/models/preset.ts");

      const restored = presetModelFresh.getPreset(imported.preset.name);
      if (!restored) throw new Error("expected imported preset");

      const rows = pluginModelFresh.listPresetPlugins(restored.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        ref: "fmt@acme-marketplace",
        version_constraint: "2.x",
        embed_on_export: false,
      });
      const embeddedRoot = bundle.embedded_plugins[0]?.root;
      if (embeddedRoot === undefined) throw new Error("expected embedded_plugins[0]");

      expect(
        existsSync(
          join(unpack, "plugins", embeddedRoot, ".claude-plugin", "plugin.json"),
        ),
      ).toBe(true);

      const bundleAgain = exporter.exportPreset(restored.id, {
        homeRoot: "",
        projectRoot: context.projectDir,
      });
      expect(bundleAgain.plugins).toEqual([
        { ref: "fmt@acme-marketplace", version_constraint: "2.x" },
      ]);
      expect(bundleAgain.embedded_plugins).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("bundle preset.version round-trips through export/import", async () => {
    const exportContext = await createInitializedTestContext("export-version-rt");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const exporter = await import("../../src/services/exporter.ts");

      const preset = presetModel.createPreset({ name: "versioned", version: "2.3.1" });

      const bundle = exporter.exportPreset(preset.id);
      expect(bundle.preset.version).toBe("2.3.1");

      const bundlePath = `${exportContext.projectDir}/versioned.json`;
      exporter.exportToFile(preset.id, bundlePath);

      const importContext = await createInitializedTestContext("import-version-rt");
      try {
        const importedExporter = await import("../../src/services/exporter.ts");
        const imported = importedExporter.importFromFile(bundlePath);
        expect(imported.preset.version).toBe("2.3.1");
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("bundle preset.dependencies round-trips through export/import", async () => {
    const exportContext = await createInitializedTestContext("export-deps-rt");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const exporter = await import("../../src/services/exporter.ts");

      const preset = presetModel.createPreset({ name: "with-deps" });
      presetModel.addDependencyToPreset(preset.id, "base-preset", "^1.0.0");
      presetModel.addDependencyToPreset(preset.id, "extra-preset", ">=2.0.0");

      const bundle = exporter.exportPreset(preset.id);
      expect(bundle.dependencies).toEqual([
        { dependency_name: "base-preset", version_constraint: "^1.0.0", order: 0 },
        { dependency_name: "extra-preset", version_constraint: ">=2.0.0", order: 1 },
      ]);

      const bundlePath = `${exportContext.projectDir}/with-deps.json`;
      exporter.exportToFile(preset.id, bundlePath);

      const importContext = await createInitializedTestContext("import-deps-rt");
      try {
        const importedExporter = await import("../../src/services/exporter.ts");
        const imported = importedExporter.importFromFile(bundlePath);
        const importedDeps = presetModel.listPresetDependencies(imported.preset.id);
        expect(importedDeps.map((d) => ({ name: d.dependency_name, vc: d.version_constraint }))).toEqual([
          { name: "base-preset", vc: "^1.0.0" },
          { name: "extra-preset", vc: ">=2.0.0" },
        ]);
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("imports a bundle with multiple resources", async () => {
    const exportContext = await createInitializedTestContext("export-multi");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const exporter = await import("../../src/services/exporter.ts");

      const preset = presetModel.createPreset({ name: "multi" });
      const r1 = resourceModel.createResource(makeResourceInput({ name: "skill-a" }));
      const r2 = resourceModel.createResource(makeResourceInput({ type: "rule", name: "rule-b" }));
      const r3 = resourceModel.createResource(makeResourceInput({ type: "agent", name: "agent-c" }));
      presetModel.addResourceToPreset(preset.id, r1.id);
      presetModel.addResourceToPreset(preset.id, r2.id);
      presetModel.addResourceToPreset(preset.id, r3.id);

      const bundlePath = join(exportContext.projectDir, "multi.json");
      exporter.exportToFile(preset.id, bundlePath);

      const importContext = await createInitializedTestContext("import-multi");
      try {
        const imported = exporter.importFromFile(bundlePath);
        expect(imported.preset.name).toBe("multi");
        expect(imported.resources).toHaveLength(3);
        expect(imported.resources.map((r) => r.name)).toEqual(["skill-a", "rule-b", "agent-c"]);
        expect(imported.resources[0]?.type).toBe("skill");
        expect(imported.resources[1]?.type).toBe("rule");
        expect(imported.resources[2]?.type).toBe("agent");
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("imports a bundle with an override name", async () => {
    const exportContext = await createInitializedTestContext("export-override");

    try {
      const exporter = await import("../../src/services/exporter.ts");
      const bundlePath = require("node:path").join(exportContext.projectDir, "override.json");
      const { writeTextFile } = await import("../helpers/fs.ts");
      writeTextFile(
        bundlePath,
        JSON.stringify({
          $schema: "urn:harnessdeck:bundle:v1",
          version: 1,
          preset: { name: "orig-name", description: "", tags: [] },
          resources: [],
        }),
      );

      const imported = exporter.importFromFile(bundlePath, { presetNameOverride: "override-name" });
      expect(imported.preset.name).toBe("override-name");
    } finally {
      await exportContext.cleanup();
    }
  });

  it("exports and imports a multi-preset bundle with shared embedded plugins", async () => {
    const exportContext = await createInitializedTestContext("export-multi-preset");

    try {
      const pluginRoot = join(exportContext.projectDir, "plugins/shared-plugin");
      mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
      writeTextFile(
        join(pluginRoot, ".claude-plugin/plugin.json"),
        JSON.stringify({ version: "1.0.0", name: "shared-plugin" }),
      );
      writeTextFile(join(pluginRoot, "README.md"), "shared plugin readme");

      const presetModel = await import("../../src/models/preset.ts");
      const pluginModel = await import("../../src/models/plugin.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const exporter = await import("../../src/services/exporter.ts");

      const alpha = presetModel.createPreset({ name: "alpha", version: "1.0.0" });
      const beta = presetModel.createPreset({ name: "beta", version: "2.0.0" });
      const alphaResource = resourceModel.createResource(makeResourceInput({ name: "alpha-skill" }));
      const betaResource = resourceModel.createResource(makeResourceInput({ name: "beta-skill" }));
      presetModel.addResourceToPreset(alpha.id, alphaResource.id);
      presetModel.addResourceToPreset(beta.id, betaResource.id);
      pluginModel.addPluginToPreset(alpha.id, "./plugins/shared-plugin", "^1.0.0");
      pluginModel.addPluginToPreset(beta.id, "./plugins/shared-plugin", "^1.0.0");

      const bundle = exporter.exportPreset([alpha.id, beta.id], {
        projectRoot: exportContext.projectDir,
      });

      expect(bundle.presets).toHaveLength(2);
      expect(bundle.presets?.map((preset) => preset.name)).toEqual(["alpha", "beta"]);
      expect(bundle.presets?.[0]).toEqual(
        expect.objectContaining({
          name: "alpha",
          version: "1.0.0",
          resources: expect.any(Array),
          plugins: [{ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }],
        }),
      );
      expect(bundle.presets?.[0]).not.toHaveProperty("preset");
      expect(bundle.embedded_plugins).toHaveLength(1);

      const bundlePath = join(exportContext.projectDir, "multi-bundle.jsonc");
      exporter.exportToFile([alpha.id, beta.id], bundlePath, {
        projectRoot: exportContext.projectDir,
      });

      const importContext = await createInitializedTestContext("import-multi-preset");

      try {
        const importedExporter = await import("../../src/services/exporter.ts");
        const importedPresetModel = await import("../../src/models/preset.ts");
        const importedPluginModel = await import("../../src/models/plugin.ts");

        const imported = importedExporter.importFromFile(bundlePath, {
          embeddedTargetDir: importContext.projectDir,
        });

        expect(imported.presets).toHaveLength(2);
        expect(imported.presets.map((entry) => entry.preset.name)).toEqual(["alpha", "beta"]);

        const importedAlpha = importedPresetModel.getPreset("alpha");
        const importedBeta = importedPresetModel.getPreset("beta");
        expect(importedAlpha).toBeDefined();
        expect(importedBeta).toBeDefined();

        if (!importedAlpha || !importedBeta) {
          throw new Error("expected imported presets");
        }

        expect(importedPluginModel.listPresetPlugins(importedAlpha.id)).toEqual([
          expect.objectContaining({ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }),
        ]);
        expect(importedPluginModel.listPresetPlugins(importedBeta.id)).toEqual([
          expect.objectContaining({ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }),
        ]);
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("imports multi-preset bundles without attaching embedded plugins to unrelated presets", async () => {
    const exportContext = await createInitializedTestContext("export-multi-preset-selective-plugin");

    try {
      const pluginRoot = join(exportContext.projectDir, "plugins/shared-plugin");
      mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
      writeTextFile(
        join(pluginRoot, ".claude-plugin/plugin.json"),
        JSON.stringify({ version: "1.0.0", name: "shared-plugin" }),
      );
      writeTextFile(join(pluginRoot, "README.md"), "shared plugin readme");

      const presetModel = await import("../../src/models/preset.ts");
      const pluginModel = await import("../../src/models/plugin.ts");
      const exporter = await import("../../src/services/exporter.ts");

      const alpha = presetModel.createPreset({ name: "alpha-only-plugin", version: "1.0.0" });
      const beta = presetModel.createPreset({ name: "beta-no-plugin", version: "1.0.0" });
      pluginModel.addPluginToPreset(alpha.id, "./plugins/shared-plugin", "^1.0.0");

      const bundle = exporter.exportPreset([alpha.id, beta.id], {
        projectRoot: exportContext.projectDir,
      });

      expect(bundle.presets).toHaveLength(2);
      expect(bundle.embedded_plugins).toHaveLength(1);
      expect(bundle.presets?.[0]?.plugins).toEqual([
        { ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" },
      ]);
      expect(bundle.presets?.[1]?.plugins).toEqual([]);
      expect(bundle.presets?.[0]).toEqual(
        expect.objectContaining({
          name: "alpha-only-plugin",
          version: "1.0.0",
          resources: [],
          plugins: [{ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }],
        }),
      );
      expect(bundle.presets?.[1]).toEqual(
        expect.objectContaining({
          name: "beta-no-plugin",
          version: "1.0.0",
          resources: [],
          plugins: [],
        }),
      );
      expect(bundle.presets?.[0]).not.toHaveProperty("preset");

      const bundlePath = join(exportContext.projectDir, "selective-multi.jsonc");
      exporter.exportToFile([alpha.id, beta.id], bundlePath, {
        projectRoot: exportContext.projectDir,
      });

      const importContext = await createInitializedTestContext("import-multi-preset-selective-plugin");

      try {
        const importedExporter = await import("../../src/services/exporter.ts");
        const importedPresetModel = await import("../../src/models/preset.ts");
        const importedPluginModel = await import("../../src/models/plugin.ts");

        importedExporter.importFromFile(bundlePath, {
          embeddedTargetDir: importContext.projectDir,
        });

        const importedAlpha = importedPresetModel.getPreset("alpha-only-plugin");
        const importedBeta = importedPresetModel.getPreset("beta-no-plugin");
        if (!importedAlpha || !importedBeta) {
          throw new Error("expected imported presets");
        }

        expect(importedPluginModel.listPresetPlugins(importedAlpha.id)).toEqual([
          expect.objectContaining({ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }),
        ]);
        expect(importedPluginModel.listPresetPlugins(importedBeta.id)).toEqual([]);
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("preserves per-preset embedded plugin version constraints when refs are shared", async () => {
    const exportContext = await createInitializedTestContext("export-shared-ref-different-constraints");

    try {
      const pluginRoot = join(exportContext.projectDir, "plugins/shared-plugin");
      mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
      writeTextFile(
        join(pluginRoot, ".claude-plugin/plugin.json"),
        JSON.stringify({ version: "1.0.0", name: "shared-plugin" }),
      );

      const presetModel = await import("../../src/models/preset.ts");
      const pluginModel = await import("../../src/models/plugin.ts");
      const exporter = await import("../../src/services/exporter.ts");

      const alpha = presetModel.createPreset({ name: "alpha-shared-ref", version: "1.0.0" });
      const beta = presetModel.createPreset({ name: "beta-shared-ref", version: "1.0.0" });
      pluginModel.addPluginToPreset(alpha.id, "./plugins/shared-plugin", "^1.0.0");
      pluginModel.addPluginToPreset(beta.id, "./plugins/shared-plugin", "^2.0.0");

      const bundle = exporter.exportPreset([alpha.id, beta.id], {
        projectRoot: exportContext.projectDir,
      });

      expect(bundle.embedded_plugins).toHaveLength(2);
      expect(bundle.presets?.[0]?.plugins).toContainEqual({
        ref: "./plugins/shared-plugin",
        version_constraint: "^1.0.0",
      });
      expect(bundle.presets?.[1]?.plugins).toContainEqual({
        ref: "./plugins/shared-plugin",
        version_constraint: "^2.0.0",
      });

      const bundlePath = join(exportContext.projectDir, "shared-ref-constraints.jsonc");
      exporter.exportToFile([alpha.id, beta.id], bundlePath, {
        projectRoot: exportContext.projectDir,
      });

      const importContext = await createInitializedTestContext("import-shared-ref-different-constraints");
      try {
        const importedExporter = await import("../../src/services/exporter.ts");
        const importedPresetModel = await import("../../src/models/preset.ts");
        const importedPluginModel = await import("../../src/models/plugin.ts");

        importedExporter.importFromFile(bundlePath, {
          embeddedTargetDir: importContext.projectDir,
        });

        const importedAlpha = importedPresetModel.getPreset("alpha-shared-ref");
        const importedBeta = importedPresetModel.getPreset("beta-shared-ref");
        if (!importedAlpha || !importedBeta) {
          throw new Error("expected imported presets");
        }

        expect(importedPluginModel.listPresetPlugins(importedAlpha.id)).toEqual([
          expect.objectContaining({ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }),
        ]);
        expect(importedPluginModel.listPresetPlugins(importedBeta.id)).toEqual([
          expect.objectContaining({ ref: "./plugins/shared-plugin", version_constraint: "^2.0.0" }),
        ]);
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });
});
