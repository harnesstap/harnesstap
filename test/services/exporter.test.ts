import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createTempDir, writeTextFile } from "../helpers/fs.ts";
import {
  makeSingleLayerExport,
  parseTestLayerToml,
  writeLayerExportToml,
} from "../helpers/transport-fixtures.ts";
import { makeResourceInput } from "../helpers/resources.ts";

async function loadLayerTransportServices() {
  const [layerExport, layerImport] = await Promise.all([
    import("../../src/services/layer-export.ts"),
    import("../../src/services/layer-import.ts"),
  ]);
  return { ...layerExport, ...layerImport };
}

describe("exporter services", () => {
  it("exports a layer bundle without internal fields", async () => {
    const context = await createInitializedTestContext("export-bundle");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const exporter = await loadLayerTransportServices();

      const layer = layerModel.createLayer({ name: "bundle" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "shared", description: "Shared skill" }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      const bundle = exporter.exportLayer(layer.id);

      expect(bundle.$schema).toBe("urn:harnesstap:layer:v1");
      expect(bundle.version).toBe(1);
      expect(bundle.layers[0]?.plugin_pins).toEqual([]);
      expect(bundle.embedded_plugins).toEqual([]);
      expect(bundle.layers[0]?.name).toBe("bundle");
      expect(bundle.layers[0]?.resources[0]).toEqual(
        expect.not.objectContaining({ id: expect.anything(), source: expect.anything() }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("writes and re-imports bundles from disk", async () => {
    const exportContext = await createInitializedTestContext("export-import-export");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const exporter = await loadLayerTransportServices();

      const layer = layerModel.createLayer({ name: "bundle" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "shared", description: "Shared skill" }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      const bundlePath = `${exportContext.projectDir}/bundle.harnesstap.toml`;
      exporter.exportToFile(layer.id, bundlePath);

      expect(existsSync(bundlePath)).toBe(true);
      expect(parseTestLayerToml(readFileSync(bundlePath, "utf-8"))).toEqual(
        expect.objectContaining({ version: 1 }),
      );

      const importContext = await createInitializedTestContext("export-import-import");

      try {
        const importedExporter = await loadLayerTransportServices();
        const imported = importedExporter.importFromFile(bundlePath);

        expect(imported.layer.name).toBe("bundle");
        expect(imported.resources).toHaveLength(1);
        expect(imported.resources[0]?.source).toBe(`import:${bundlePath}`);
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("writes TOML bundles with a leading comment block", async () => {
    const exportContext = await createInitializedTestContext("export-toml-comment-block");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const exporter = await loadLayerTransportServices();

      const layer = layerModel.createLayer({ name: "commented-export" });
      const bundlePath = join(exportContext.projectDir, "commented-export.harnesstap.toml");
      exporter.exportToFile(layer.id, bundlePath);

      const raw = readFileSync(bundlePath, "utf-8");
      expect(raw.startsWith("# HarnessTap layer export\n")).toBe(true);
      expect(raw).toContain('schema = "urn:harnesstap:layer:v1"');
      expect(raw).toContain("# Source machine: ");

      const importContext = await createInitializedTestContext("import-toml-comment-block");
      try {
        const importedExporter = await loadLayerTransportServices();
        expect(() => importedExporter.importFromFile(bundlePath)).not.toThrow();
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("throws when exporting a non-existent layer", async () => {
    const context = await createInitializedTestContext("export-not-found");

    try {
      const exporter = await loadLayerTransportServices();

      expect(() => exporter.exportLayer("non-existent-layer")).toThrow(
        "Layer not found: non-existent-layer",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("throws when importing with unsupported layer version", async () => {
    const context = await createInitializedTestContext("export-bad-version");

    try {
      const exporter = await loadLayerTransportServices();
      const tempDir = createTempDir("export-bad-version");

      try {
        const bundlePath = join(tempDir, "bundle.harnesstap.toml");
        writeTextFile(bundlePath, `schema = "urn:harnesstap:layer:v1"
version = 99

[[layers]]
name = "bad-version"
description = ""
tags = []
version = "1.0.0"
plugins = []
`);

        expect(() => exporter.importFromFile(bundlePath)).toThrow(
          "Unsupported layer version: 99",
        );
      } finally {
        require("node:fs").rmSync(tempDir, { recursive: true, force: true });
      }
    } finally {
      await context.cleanup();
    }
  });

  it("throws when importing malformed TOML", async () => {
    const context = await createInitializedTestContext("export-malformed");

    try {
      const exporter = await loadLayerTransportServices();
      const tempDir = createTempDir("export-malformed");

      try {
        const bundlePath = join(tempDir, "bundle.harnesstap.toml");
        writeTextFile(bundlePath, "this is not toml [[[");

        expect(() => exporter.importFromFile(bundlePath)).toThrow();
      } finally {
        require("node:fs").rmSync(tempDir, { recursive: true, force: true });
      }
    } finally {
      await context.cleanup();
    }
  });

  it("throws when importing truncated TOML that parses to a partial object", async () => {
    const context = await createInitializedTestContext("export-truncated-toml");

    try {
      const exporter = await loadLayerTransportServices();
      const tempDir = createTempDir("export-truncated-toml");

      try {
        const bundlePath = join(tempDir, "bundle.harnesstap.toml");
        writeTextFile(
          bundlePath,
          `schema = "urn:harnesstap:layer:v1"
version = 1

[[layers
name = "truncated-bundle"
`,
        );

        expect(() => exporter.importFromFile(bundlePath)).toThrow();
      } finally {
        require("node:fs").rmSync(tempDir, { recursive: true, force: true });
      }
    } finally {
      await context.cleanup();
    }
  });

  it("imports a bundle file with comments", async () => {
    const context = await createInitializedTestContext("export-toml-import");

    try {
      const exporter = await loadLayerTransportServices();
      const tempDir = createTempDir("export-toml-import");

      try {
        const bundlePath = join(tempDir, "bundle.harnesstap.toml");
        writeTextFile(
          bundlePath,
          `# comment before schema
schema = "urn:harnesstap:layer:v1"
version = 1

[[layers]]
name = "toml-bundle"
description = "TOML bundle"
tags = ["toml"]
version = "1.2.3"
plugins = []

[[layers.resources]]
type = "instruction"
name = "shared"
description = "Shared skill"
content = "# Shared"
`,
        );

        const imported = exporter.importFromFile(bundlePath);
        expect(imported.layer.name).toBe("toml-bundle");
        expect(imported.layer.version).toBe("1.2.3");
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
      const layerModel = await import("../../src/models/layer-model.ts");
      const pluginPins = await import("../../src/services/layer-composition.ts");
      const exporter = await loadLayerTransportServices();

      const layer = layerModel.createLayer({ name: "plugs" });
      pluginPins.attachPluginPinToLayer(layer.id, "fmt@acme-marketplace", ">=2");

      const bundle = exporter.exportLayer(layer.id);
      expect(bundle.version).toBe(1);
      expect(bundle.layers[0]?.plugin_pins).toEqual([
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

      const layerModel = await import("../../src/models/layer-model.ts");
      const pluginPins = await import("../../src/services/layer-composition.ts");
      const exporter = await loadLayerTransportServices();

      const layer = layerModel.createLayer({ name: "local-plug" });
      pluginPins.attachPluginPinToLayer(layer.id, "./plugins/demo", "1.x");

      const bundle = exporter.exportLayer(layer.id, {
        projectRoot: context.projectDir,
      });
      expect(bundle.layers[0]?.plugin_pins).toEqual([
        { ref: "./plugins/demo", version_constraint: "1.x" },
      ]);
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

      const layerModel = await import("../../src/models/layer-model.ts");
      const pluginPins = await import("../../src/services/layer-composition.ts");
      const exporter = await loadLayerTransportServices();

      const layer = layerModel.createLayer({ name: "mkt-plug" });
      pluginPins.attachPluginPinToLayer(layer.id, "fmt@acme-marketplace", "2.x");

      const bundle = exporter.exportLayer(layer.id, {
        embedPlugins: true,
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
      });
      expect(bundle.layers[0]?.plugin_pins).toEqual([
        { ref: "fmt@acme-marketplace", version_constraint: "2.x" },
      ]);
      expect(bundle.embedded_plugins).toHaveLength(1);
      expect(bundle.embedded_plugins[0]?.ref).toBe("fmt@acme-marketplace");

      const bundlePath = join(context.projectDir, "embedded.harnesstap.toml");
      exporter.exportToFile(layer.id, bundlePath, {
        embedPlugins: true,
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
      });

      layerModel.deleteLayer(layer.id);
      const unpack = join(context.projectDir, "unpacked-plugins");
      mkdirSync(unpack, { recursive: true });

      const imported = exporter.importFromFile(bundlePath, {
        embeddedTargetDir: unpack,
      });
      const pluginModelFresh = await import("../../src/services/layer-composition.ts");
      const layerModelFresh = await import("../../src/models/layer-model.ts");

      const restored = layerModelFresh.getLayer(imported.layer.name);
      if (!restored) throw new Error("expected imported layer");

      const rows = pluginModelFresh.listLayerPlugins(restored.id);
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

      const bundleAgain = exporter.exportLayer(restored.id, {
        homeRoot: "",
        projectRoot: context.projectDir,
      });
      expect(bundleAgain.layers[0]?.plugin_pins).toEqual([
        { ref: "fmt@acme-marketplace", version_constraint: "2.x" },
      ]);
      expect(bundleAgain.embedded_plugins).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("bundle layer.version round-trips through export/import", async () => {
    const exportContext = await createInitializedTestContext("export-version-rt");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const exporter = await loadLayerTransportServices();

      const layer = layerModel.createLayer({ name: "versioned", version: "2.3.1" });

      const bundle = exporter.exportLayer(layer.id);
      expect(bundle.layers[0]?.version).toBe("2.3.1");

      const bundlePath = `${exportContext.projectDir}/versioned.harnesstap.toml`;
      exporter.exportToFile(layer.id, bundlePath);

      const importContext = await createInitializedTestContext("import-version-rt");
      try {
        const importedExporter = await loadLayerTransportServices();
        const imported = importedExporter.importFromFile(bundlePath);
        expect(imported.layer.version).toBe("2.3.1");
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("bundle layer.dependencies round-trips through export/import", async () => {
    const exportContext = await createInitializedTestContext("export-deps-rt");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const exporter = await loadLayerTransportServices();

      const layer = layerModel.createLayer({ name: "with-deps" });
      layerModel.addDependencyToLayer(layer.id, "base-layer", "^1.0.0");
      layerModel.addDependencyToLayer(layer.id, "extra-layer", ">=2.0.0");

      const bundle = exporter.exportLayer(layer.id);
      expect(bundle.layers[0]?.dependencies).toEqual([
        { dependency_name: "base-layer", version_constraint: "^1.0.0", order: 0 },
        { dependency_name: "extra-layer", version_constraint: ">=2.0.0", order: 1 },
      ]);

      const bundlePath = `${exportContext.projectDir}/with-deps.harnesstap.toml`;
      exporter.exportToFile(layer.id, bundlePath);

      const importContext = await createInitializedTestContext("import-deps-rt");
      try {
        const importedExporter = await loadLayerTransportServices();
        const imported = importedExporter.importFromFile(bundlePath);
        const importedDeps = layerModel.listLayerDependencies(imported.layer.id);
        expect(importedDeps.map((d) => ({ name: d.dependency_name, vc: d.version_constraint }))).toEqual([
          { name: "base-layer", vc: "^1.0.0" },
          { name: "extra-layer", vc: ">=2.0.0" },
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
      const layerModel = await import("../../src/models/layer-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const exporter = await loadLayerTransportServices();

      const layer = layerModel.createLayer({ name: "multi" });
      const r1 = resourceModel.createResource(makeResourceInput({ name: "skill-a" }));
      const r2 = resourceModel.createResource(makeResourceInput({ type: "rule", name: "rule-b" }));
      const r3 = resourceModel.createResource(makeResourceInput({ type: "agent", name: "agent-c" }));
      layerModel.addResourceToLayer(layer.id, r1.id);
      layerModel.addResourceToLayer(layer.id, r2.id);
      layerModel.addResourceToLayer(layer.id, r3.id);

      const bundlePath = join(exportContext.projectDir, "multi.harnesstap.toml");
      exporter.exportToFile(layer.id, bundlePath);

      const importContext = await createInitializedTestContext("import-multi");
      try {
        const imported = exporter.importFromFile(bundlePath);
        expect(imported.layer.name).toBe("multi");
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
      const exporter = await loadLayerTransportServices();
      const bundlePath = require("node:path").join(exportContext.projectDir, "override.harnesstap.toml");
      writeLayerExportToml(
        bundlePath,
        makeSingleLayerExport({ name: "orig-name" }),
      );

      const imported = exporter.importFromFile(bundlePath, { layerNameOverride: "override-name" });
      expect(imported.layer.name).toBe("override-name");
    } finally {
      await exportContext.cleanup();
    }
  });

  it("exports and imports a multi-layer bundle with shared embedded plugins", async () => {
    const exportContext = await createInitializedTestContext("export-multi-layer");

    try {
      const pluginRoot = join(exportContext.projectDir, "plugins/shared-plugin");
      mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
      writeTextFile(
        join(pluginRoot, ".claude-plugin/plugin.json"),
        JSON.stringify({ version: "1.0.0", name: "shared-plugin" }),
      );
      writeTextFile(join(pluginRoot, "README.md"), "shared plugin readme");

      const layerModel = await import("../../src/models/layer-model.ts");
      const pluginPins = await import("../../src/services/layer-composition.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const exporter = await loadLayerTransportServices();

      const alpha = layerModel.createLayer({ name: "alpha", version: "1.0.0" });
      const beta = layerModel.createLayer({ name: "beta", version: "2.0.0" });
      const alphaResource = resourceModel.createResource(makeResourceInput({ name: "alpha-skill" }));
      const betaResource = resourceModel.createResource(makeResourceInput({ name: "beta-skill" }));
      layerModel.addResourceToLayer(alpha.id, alphaResource.id);
      layerModel.addResourceToLayer(beta.id, betaResource.id);
      pluginPins.attachPluginPinToLayer(alpha.id, "./plugins/shared-plugin", "^1.0.0");
      pluginPins.attachPluginPinToLayer(beta.id, "./plugins/shared-plugin", "^1.0.0");

      const bundle = exporter.exportLayer([alpha.id, beta.id], {
        projectRoot: exportContext.projectDir,
      });

      expect(bundle.layers).toHaveLength(2);
      expect(bundle.layers?.map((layer) => layer.name)).toEqual(["alpha", "beta"]);
      expect(bundle.layers?.[0]).toEqual(
        expect.objectContaining({
          name: "alpha",
          version: "1.0.0",
          resources: expect.any(Array),
          plugin_pins: [{ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }],
        }),
      );
      expect(bundle.layers?.[0]).not.toHaveProperty("layer");
      expect(bundle.embedded_plugins).toHaveLength(1);

      const bundlePath = join(exportContext.projectDir, "multi-bundle.harnesstap.toml");
      exporter.exportToFile([alpha.id, beta.id], bundlePath, {
        projectRoot: exportContext.projectDir,
      });

      const importContext = await createInitializedTestContext("import-multi-layer");

      try {
        const importedExporter = await loadLayerTransportServices();
        const importedLayerModel = await import("../../src/models/layer-model.ts");
        const importedPluginModel = await import("../../src/services/layer-composition.ts");

        const imported = importedExporter.importFromFile(bundlePath, {
          embeddedTargetDir: importContext.projectDir,
        });

        expect(imported.layers).toHaveLength(2);
        expect(imported.layers.map((entry) => entry.layer.name)).toEqual(["alpha", "beta"]);

        const importedAlpha = importedLayerModel.getLayer("alpha");
        const importedBeta = importedLayerModel.getLayer("beta");
        expect(importedAlpha).toBeDefined();
        expect(importedBeta).toBeDefined();

        if (!importedAlpha || !importedBeta) {
          throw new Error("expected imported layers");
        }

        expect(importedPluginModel.listLayerPlugins(importedAlpha.id)).toEqual([
          expect.objectContaining({ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }),
        ]);
        expect(importedPluginModel.listLayerPlugins(importedBeta.id)).toEqual([
          expect.objectContaining({ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }),
        ]);
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("imports multi-layer bundles without attaching embedded plugins to unrelated layers", async () => {
    const exportContext = await createInitializedTestContext("export-multi-layer-selective-plugin");

    try {
      const pluginRoot = join(exportContext.projectDir, "plugins/shared-plugin");
      mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
      writeTextFile(
        join(pluginRoot, ".claude-plugin/plugin.json"),
        JSON.stringify({ version: "1.0.0", name: "shared-plugin" }),
      );
      writeTextFile(join(pluginRoot, "README.md"), "shared plugin readme");

      const layerModel = await import("../../src/models/layer-model.ts");
      const pluginPins = await import("../../src/services/layer-composition.ts");
      const exporter = await loadLayerTransportServices();

      const alpha = layerModel.createLayer({ name: "alpha-only-plugin", version: "1.0.0" });
      const beta = layerModel.createLayer({ name: "beta-no-plugin", version: "1.0.0" });
      pluginPins.attachPluginPinToLayer(alpha.id, "./plugins/shared-plugin", "^1.0.0");

      const bundle = exporter.exportLayer([alpha.id, beta.id], {
        projectRoot: exportContext.projectDir,
      });

      expect(bundle.layers).toHaveLength(2);
      expect(bundle.embedded_plugins).toHaveLength(1);
      expect(bundle.layers?.[0]?.plugin_pins).toEqual([
        { ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" },
      ]);
      expect(bundle.layers?.[1]?.plugin_pins).toEqual([]);
      expect(bundle.layers?.[0]).toEqual(
        expect.objectContaining({
          name: "alpha-only-plugin",
          version: "1.0.0",
          resources: [],
          plugin_pins: [{ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }],
        }),
      );
      expect(bundle.layers?.[1]).toEqual(
        expect.objectContaining({
          name: "beta-no-plugin",
          version: "1.0.0",
          resources: [],
          plugin_pins: [],
        }),
      );
      expect(bundle.layers?.[0]).not.toHaveProperty("layer");

      const bundlePath = join(exportContext.projectDir, "selective-multi.harnesstap.toml");
      exporter.exportToFile([alpha.id, beta.id], bundlePath, {
        projectRoot: exportContext.projectDir,
      });

      const importContext = await createInitializedTestContext("import-multi-layer-selective-plugin");

      try {
        const importedExporter = await loadLayerTransportServices();
        const importedLayerModel = await import("../../src/models/layer-model.ts");
        const importedPluginModel = await import("../../src/services/layer-composition.ts");

        importedExporter.importFromFile(bundlePath, {
          embeddedTargetDir: importContext.projectDir,
        });

        const importedAlpha = importedLayerModel.getLayer("alpha-only-plugin");
        const importedBeta = importedLayerModel.getLayer("beta-no-plugin");
        if (!importedAlpha || !importedBeta) {
          throw new Error("expected imported layers");
        }

        expect(importedPluginModel.listLayerPlugins(importedAlpha.id)).toEqual([
          expect.objectContaining({ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }),
        ]);
        expect(importedPluginModel.listLayerPlugins(importedBeta.id)).toEqual([]);
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("preserves per-layer embedded plugin version constraints when refs are shared", async () => {
    const exportContext = await createInitializedTestContext("export-shared-ref-different-constraints");

    try {
      const pluginRoot = join(exportContext.projectDir, "plugins/shared-plugin");
      mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
      writeTextFile(
        join(pluginRoot, ".claude-plugin/plugin.json"),
        JSON.stringify({ version: "1.0.0", name: "shared-plugin" }),
      );

      const layerModel = await import("../../src/models/layer-model.ts");
      const pluginPins = await import("../../src/services/layer-composition.ts");
      const exporter = await loadLayerTransportServices();

      const alpha = layerModel.createLayer({ name: "alpha-shared-ref", version: "1.0.0" });
      const beta = layerModel.createLayer({ name: "beta-shared-ref", version: "1.0.0" });
      pluginPins.attachPluginPinToLayer(alpha.id, "./plugins/shared-plugin", "^1.0.0");
      pluginPins.attachPluginPinToLayer(beta.id, "./plugins/shared-plugin", "^2.0.0");

      const bundle = exporter.exportLayer([alpha.id, beta.id], {
        projectRoot: exportContext.projectDir,
      });

      expect(bundle.embedded_plugins).toHaveLength(2);
      expect(bundle.layers?.[0]?.plugin_pins).toContainEqual({
        ref: "./plugins/shared-plugin",
        version_constraint: "^1.0.0",
      });
      expect(bundle.layers?.[1]?.plugin_pins).toContainEqual({
        ref: "./plugins/shared-plugin",
        version_constraint: "^2.0.0",
      });

      const bundlePath = join(exportContext.projectDir, "shared-ref-constraints.harnesstap.toml");
      exporter.exportToFile([alpha.id, beta.id], bundlePath, {
        projectRoot: exportContext.projectDir,
      });

      const importContext = await createInitializedTestContext("import-shared-ref-different-constraints");
      try {
        const importedExporter = await loadLayerTransportServices();
        const importedLayerModel = await import("../../src/models/layer-model.ts");
        const importedPluginModel = await import("../../src/services/layer-composition.ts");

        importedExporter.importFromFile(bundlePath, {
          embeddedTargetDir: importContext.projectDir,
        });

        const importedAlpha = importedLayerModel.getLayer("alpha-shared-ref");
        const importedBeta = importedLayerModel.getLayer("beta-shared-ref");
        if (!importedAlpha || !importedBeta) {
          throw new Error("expected imported layers");
        }

        expect(importedPluginModel.listLayerPlugins(importedAlpha.id)).toEqual([
          expect.objectContaining({ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }),
        ]);
        expect(importedPluginModel.listLayerPlugins(importedBeta.id)).toEqual([
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
