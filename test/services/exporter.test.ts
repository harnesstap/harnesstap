import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createTempDir, writeTextFile } from "../helpers/fs.ts";
import {
  makeSinglePluginExport,
  parseTestPluginToml,
  writePluginExportToml,
} from "../helpers/transport-fixtures.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { cutPluginVersion } from "../../src/services/plugin-versioning.ts";
import { getPlugin } from "../../src/models/plugin-model.ts";

function cutHead(pluginId: string, newVersion: string): string {
  const head = cutPluginVersion({ pluginId, newVersion });
  return head.id;
}

async function loadPluginTransportServices() {
  const [pluginExport, pluginImport] = await Promise.all([
    import("../../src/services/plugin-export.ts"),
    import("../../src/services/plugin-import.ts"),
  ]);
  return { ...pluginExport, ...pluginImport };
}

describe("exporter services", () => {
  it("exports a plugin bundle without internal fields", async () => {
    const context = await createInitializedTestContext("export-bundle");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const exporter = await loadPluginTransportServices();

      let plugin = pluginModel.createPlugin({ name: "bundle" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "shared", description: "Shared skill" }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const bundle = exporter.exportPlugin(plugin.id);

      expect(bundle.$schema).toBe("urn:harnesstap:layer:v1");
      expect(bundle.version).toBe(1);
      expect(bundle.plugins[0]?.plugin_pins).toEqual([]);
      expect(bundle.embedded_plugins).toEqual([]);
      expect(bundle.plugins[0]?.name).toBe("bundle");
      expect(bundle.plugins[0]?.resources[0]).toEqual(
        expect.not.objectContaining({ id: expect.anything(), source: expect.anything() }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("rejects export when the plugin head is dirty", async () => {
    const context = await createInitializedTestContext("export-dirty-plugin");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const versioning = await import("../../src/services/plugin-versioning.ts");
      const exporter = await loadPluginTransportServices();

      let plugin = pluginModel.createPlugin({ name: "dirty-export", version: "1.0.0" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "shared", description: "Shared skill" }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);
      versioning.markPluginDirty(plugin.id);

      expect(() => exporter.exportPlugin(plugin.id)).toThrow(
        /Cannot share plugins with unpublished edits: dirty-export@1\.0\.0/,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("writes and re-imports bundles from disk", async () => {
    const exportContext = await createInitializedTestContext("export-import-export");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const exporter = await loadPluginTransportServices();

      let plugin = pluginModel.createPlugin({ name: "bundle" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "shared", description: "Shared skill" }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const bundlePath = `${exportContext.projectDir}/bundle.harnesstap.toml`;
      exporter.exportToFile(plugin.id, bundlePath);

      expect(existsSync(bundlePath)).toBe(true);
      expect(parseTestPluginToml(readFileSync(bundlePath, "utf-8"))).toEqual(
        expect.objectContaining({ version: 1 }),
      );

      const importContext = await createInitializedTestContext("export-import-import");

      try {
        const importedExporter = await loadPluginTransportServices();
        const imported = importedExporter.importFromFile(bundlePath);

        expect(imported.plugin.name).toBe("bundle");
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
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const exporter = await loadPluginTransportServices();

      let plugin = pluginModel.createPlugin({ name: "commented-export" });
      const bundlePath = join(exportContext.projectDir, "commented-export.harnesstap.toml");
      exporter.exportToFile(plugin.id, bundlePath);

      const raw = readFileSync(bundlePath, "utf-8");
      expect(raw.startsWith("# HarnessTap plugin export\n")).toBe(true);
      expect(raw).toContain('schema = "urn:harnesstap:layer:v1"');
      expect(raw).toContain("# Source machine: ");

      const importContext = await createInitializedTestContext("import-toml-comment-block");
      try {
        const importedExporter = await loadPluginTransportServices();
        expect(() => importedExporter.importFromFile(bundlePath)).not.toThrow();
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("throws when exporting a non-existent plugin", async () => {
    const context = await createInitializedTestContext("export-not-found");

    try {
      const exporter = await loadPluginTransportServices();

      expect(() => exporter.exportPlugin("non-existent-plugin")).toThrow(
        "Plugin not found: non-existent-plugin",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("throws when importing with unsupported plugin version", async () => {
    const context = await createInitializedTestContext("export-bad-version");

    try {
      const exporter = await loadPluginTransportServices();
      const tempDir = createTempDir("export-bad-version");

      try {
        const bundlePath = join(tempDir, "bundle.harnesstap.toml");
        writeTextFile(bundlePath, `schema = "urn:harnesstap:layer:v1"
version = 99

[[plugins]]
name = "bad-version"
description = ""
tags = []
version = "1.0.0"
plugins = []
`);

        expect(() => exporter.importFromFile(bundlePath)).toThrow(
          "Unsupported plugin version: 99",
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
      const exporter = await loadPluginTransportServices();
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
      const exporter = await loadPluginTransportServices();
      const tempDir = createTempDir("export-truncated-toml");

      try {
        const bundlePath = join(tempDir, "bundle.harnesstap.toml");
        writeTextFile(
          bundlePath,
          `schema = "urn:harnesstap:layer:v1"
version = 1

[[plugins
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
      const exporter = await loadPluginTransportServices();
      const tempDir = createTempDir("export-toml-import");

      try {
        const bundlePath = join(tempDir, "bundle.harnesstap.toml");
        writeTextFile(
          bundlePath,
          `# comment before schema
schema = "urn:harnesstap:layer:v1"
version = 1

[[plugins]]
name = "toml-bundle"
description = "TOML bundle"
tags = ["toml"]
version = "1.2.3"
plugins = []

[[plugins.resources]]
type = "instruction"
name = "shared"
description = "Shared skill"
content = "# Shared"
`,
        );

        const imported = exporter.importFromFile(bundlePath);
        expect(imported.plugin.name).toBe("toml-bundle");
        expect(imported.plugin.version).toBe("1.2.3");
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
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const pluginPins = await import("../../src/services/plugin-composition.ts");
      const exporter = await loadPluginTransportServices();

      const created = pluginModel.createPlugin({ name: "plugs" });
      pluginPins.attachPluginPinToPlugin(created.id, "fmt@acme-marketplace", ">=2");
      const plugin = getPlugin(cutHead(created.id, "1.11.0"))!;

      const bundle = exporter.exportPlugin(plugin.id);
      expect(bundle.version).toBe(1);
      expect(bundle.plugins[0]?.plugin_pins).toEqual([
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

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const pluginPins = await import("../../src/services/plugin-composition.ts");
      const exporter = await loadPluginTransportServices();

      let plugin = pluginModel.createPlugin({ name: "local-plug" });
      pluginPins.attachPluginPinToPlugin(plugin.id, "./plugins/demo", "1.x");
      plugin = getPlugin(cutHead(plugin.id, "1.12.0"))!;

      const bundle = exporter.exportPlugin(plugin.id, {
        projectRoot: context.projectDir,
      });
      expect(bundle.plugins[0]?.plugin_pins).toEqual([
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

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const pluginPins = await import("../../src/services/plugin-composition.ts");
      const exporter = await loadPluginTransportServices();

      let plugin = pluginModel.createPlugin({ name: "mkt-plug" });
      pluginPins.attachPluginPinToPlugin(plugin.id, "fmt@acme-marketplace", "2.x");
      plugin = getPlugin(cutHead(plugin.id, "1.13.0"))!;

      const bundle = exporter.exportPlugin(plugin.id, {
        embedPlugins: true,
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
      });
      expect(bundle.plugins[0]?.plugin_pins).toEqual([
        { ref: "fmt@acme-marketplace", version_constraint: "2.x" },
      ]);
      expect(bundle.embedded_plugins).toHaveLength(1);
      expect(bundle.embedded_plugins[0]?.ref).toBe("fmt@acme-marketplace");

      const bundlePath = join(context.projectDir, "embedded.harnesstap.toml");
      exporter.exportToFile(plugin.id, bundlePath, {
        embedPlugins: true,
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
      });

      pluginModel.deletePlugin(plugin.id);
      const unpack = join(context.projectDir, "unpacked-plugins");
      mkdirSync(unpack, { recursive: true });

      const imported = exporter.importFromFile(bundlePath, {
        embeddedTargetDir: unpack,
      });
      const pluginCompositionFresh = await import("../../src/services/plugin-composition.ts");
      const pluginModelFresh = await import("../../src/models/plugin-model.ts");

      const restored = pluginModelFresh.getPlugin(imported.plugin.name);
      if (!restored) throw new Error("expected imported plugin");

      const rows = pluginCompositionFresh.listAttachedPluginPins(restored.id);
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

      const restoredHead = getPlugin(cutHead(restored.id, "1.13.1"))!;
      const bundleAgain = exporter.exportPlugin(restoredHead.id, {
        homeRoot: "",
        projectRoot: context.projectDir,
      });
      expect(bundleAgain.plugins[0]?.plugin_pins).toEqual([
        { ref: "fmt@acme-marketplace", version_constraint: "2.x" },
      ]);
      expect(bundleAgain.embedded_plugins).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("bundle plugin.version round-trips through export/import", async () => {
    const exportContext = await createInitializedTestContext("export-version-rt");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const exporter = await loadPluginTransportServices();

      let plugin = pluginModel.createPlugin({ name: "versioned", version: "2.3.1" });

      const bundle = exporter.exportPlugin(plugin.id);
      expect(bundle.plugins[0]?.version).toBe("2.3.1");

      const bundlePath = `${exportContext.projectDir}/versioned.harnesstap.toml`;
      exporter.exportToFile(plugin.id, bundlePath);

      const importContext = await createInitializedTestContext("import-version-rt");
      try {
        const importedExporter = await loadPluginTransportServices();
        const imported = importedExporter.importFromFile(bundlePath);
        expect(imported.plugin.version).toBe("2.3.1");
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("bundle plugin.dependencies round-trips through export/import", async () => {
    const exportContext = await createInitializedTestContext("export-deps-rt");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const exporter = await loadPluginTransportServices();

      let plugin = pluginModel.createPlugin({ name: "with-deps" });
      pluginModel.addDependencyToPlugin(plugin.id, "base-plugin", "^1.0.0");
      pluginModel.addDependencyToPlugin(plugin.id, "extra-plugin", ">=2.0.0");

      const bundle = exporter.exportPlugin(plugin.id);
      expect(bundle.plugins[0]?.dependencies).toEqual([
        { dependency_name: "base-plugin", version_constraint: "^1.0.0", order: 0 },
        { dependency_name: "extra-plugin", version_constraint: ">=2.0.0", order: 1 },
      ]);

      const bundlePath = `${exportContext.projectDir}/with-deps.harnesstap.toml`;
      exporter.exportToFile(plugin.id, bundlePath);

      const importContext = await createInitializedTestContext("import-deps-rt");
      try {
        const importedExporter = await loadPluginTransportServices();
        const imported = importedExporter.importFromFile(bundlePath);
        const importedDeps = pluginModel.listPluginDependencies(imported.plugin.id);
        expect(importedDeps.map((d) => ({ name: d.dependency_name, vc: d.version_constraint }))).toEqual([
          { name: "base-plugin", vc: "^1.0.0" },
          { name: "extra-plugin", vc: ">=2.0.0" },
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
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const exporter = await loadPluginTransportServices();

      let plugin = pluginModel.createPlugin({ name: "multi" });
      const r1 = resourceModel.createResource(makeResourceInput({ name: "skill-a" }));
      const r2 = resourceModel.createResource(makeResourceInput({ type: "rule", name: "rule-b" }));
      const r3 = resourceModel.createResource(makeResourceInput({ type: "agent", name: "agent-c" }));
      pluginModel.addResourceToPlugin(plugin.id, r1.id);
      pluginModel.addResourceToPlugin(plugin.id, r2.id);
      pluginModel.addResourceToPlugin(plugin.id, r3.id);

      const bundlePath = join(exportContext.projectDir, "multi.harnesstap.toml");
      exporter.exportToFile(plugin.id, bundlePath);

      const importContext = await createInitializedTestContext("import-multi");
      try {
        const imported = exporter.importFromFile(bundlePath);
        expect(imported.plugin.name).toBe("multi");
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
      const exporter = await loadPluginTransportServices();
      const bundlePath = require("node:path").join(exportContext.projectDir, "override.harnesstap.toml");
      writePluginExportToml(
        bundlePath,
        makeSinglePluginExport({ name: "orig-name" }),
      );

      const imported = exporter.importFromFile(bundlePath, { pluginNameOverride: "override-name" });
      expect(imported.plugin.name).toBe("override-name");
    } finally {
      await exportContext.cleanup();
    }
  });

  it("exports and imports a multi-plugin bundle with shared embedded plugins", async () => {
    const exportContext = await createInitializedTestContext("export-multi-plugin");

    try {
      const pluginRoot = join(exportContext.projectDir, "plugins/shared-plugin");
      mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
      writeTextFile(
        join(pluginRoot, ".claude-plugin/plugin.json"),
        JSON.stringify({ version: "1.0.0", name: "shared-plugin" }),
      );
      writeTextFile(join(pluginRoot, "README.md"), "shared plugin readme");

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const pluginPins = await import("../../src/services/plugin-composition.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const exporter = await loadPluginTransportServices();

      let alpha = pluginModel.createPlugin({ name: "alpha", version: "1.0.0" });
      let beta = pluginModel.createPlugin({ name: "beta", version: "2.0.0" });
      const alphaResource = resourceModel.createResource(makeResourceInput({ name: "alpha-skill" }));
      const betaResource = resourceModel.createResource(makeResourceInput({ name: "beta-skill" }));
      pluginModel.addResourceToPlugin(alpha.id, alphaResource.id);
      pluginModel.addResourceToPlugin(beta.id, betaResource.id);
      pluginPins.attachPluginPinToPlugin(alpha.id, "./plugins/shared-plugin", "^1.0.0");
      pluginPins.attachPluginPinToPlugin(beta.id, "./plugins/shared-plugin", "^1.0.0");
      alpha = getPlugin(cutHead(alpha.id, "1.14.0"))!;
      beta = getPlugin(cutHead(beta.id, "1.15.0"))!;

      const bundle = exporter.exportPlugin([alpha.id, beta.id], {
        projectRoot: exportContext.projectDir,
      });

      expect(bundle.plugins).toHaveLength(2);
      expect(bundle.plugins?.map((plugin) => plugin.name)).toEqual(["alpha", "beta"]);
      expect(bundle.plugins?.[0]).toEqual(
        expect.objectContaining({
          name: "alpha",
          version: expect.any(String),
          resources: expect.any(Array),
          plugin_pins: [{ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }],
        }),
      );
      expect(bundle.plugins?.[0]).not.toHaveProperty("plugin");
      expect(bundle.embedded_plugins).toHaveLength(1);

      const bundlePath = join(exportContext.projectDir, "multi-bundle.harnesstap.toml");
      exporter.exportToFile([alpha.id, beta.id], bundlePath, {
        projectRoot: exportContext.projectDir,
      });

      const importContext = await createInitializedTestContext("import-multi-plugin");

      try {
        const importedExporter = await loadPluginTransportServices();
        const importedPluginModel = await import("../../src/models/plugin-model.ts");
        const importedPluginComposition = await import("../../src/services/plugin-composition.ts");

        const imported = importedExporter.importFromFile(bundlePath, {
          embeddedTargetDir: importContext.projectDir,
        });

        expect(imported.plugins).toHaveLength(2);
        expect(imported.plugins.map((entry) => entry.plugin.name)).toEqual(["alpha", "beta"]);

        const importedAlpha = importedPluginModel.getPlugin("alpha");
        const importedBeta = importedPluginModel.getPlugin("beta");
        expect(importedAlpha).toBeDefined();
        expect(importedBeta).toBeDefined();

        if (!importedAlpha || !importedBeta) {
          throw new Error("expected imported plugins");
        }

        expect(importedPluginComposition.listAttachedPluginPins(importedAlpha.id)).toEqual([
          expect.objectContaining({ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }),
        ]);
        expect(importedPluginComposition.listAttachedPluginPins(importedBeta.id)).toEqual([
          expect.objectContaining({ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }),
        ]);
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("imports multi-plugin bundles without attaching embedded plugins to unrelated plugins", async () => {
    const exportContext = await createInitializedTestContext("export-multi-plugin-selective-plugin");

    try {
      const pluginRoot = join(exportContext.projectDir, "plugins/shared-plugin");
      mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
      writeTextFile(
        join(pluginRoot, ".claude-plugin/plugin.json"),
        JSON.stringify({ version: "1.0.0", name: "shared-plugin" }),
      );
      writeTextFile(join(pluginRoot, "README.md"), "shared plugin readme");

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const pluginPins = await import("../../src/services/plugin-composition.ts");
      const exporter = await loadPluginTransportServices();

      let alpha = pluginModel.createPlugin({ name: "alpha-only-plugin", version: "1.0.0" });
      let beta = pluginModel.createPlugin({ name: "beta-no-plugin", version: "1.0.0" });
      pluginPins.attachPluginPinToPlugin(alpha.id, "./plugins/shared-plugin", "^1.0.0");
      alpha = getPlugin(cutHead(alpha.id, "1.16.0"))!;

      const bundle = exporter.exportPlugin([alpha.id, beta.id], {
        projectRoot: exportContext.projectDir,
      });

      expect(bundle.plugins).toHaveLength(2);
      expect(bundle.embedded_plugins).toHaveLength(1);
      expect(bundle.plugins?.[0]?.plugin_pins).toEqual([
        { ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" },
      ]);
      expect(bundle.plugins?.[1]?.plugin_pins).toEqual([]);
      expect(bundle.plugins?.[0]).toEqual(
        expect.objectContaining({
          name: "alpha-only-plugin",
          version: expect.any(String),
          resources: [],
          plugin_pins: [{ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }],
        }),
      );
      expect(bundle.plugins?.[1]).toEqual(
        expect.objectContaining({
          name: "beta-no-plugin",
          version: expect.any(String),
          resources: [],
          plugin_pins: [],
        }),
      );
      expect(bundle.plugins?.[0]).not.toHaveProperty("plugin");

      const bundlePath = join(exportContext.projectDir, "selective-multi.harnesstap.toml");
      exporter.exportToFile([alpha.id, beta.id], bundlePath, {
        projectRoot: exportContext.projectDir,
      });

      const importContext = await createInitializedTestContext("import-multi-plugin-selective-plugin");

      try {
        const importedExporter = await loadPluginTransportServices();
        const importedPluginModel = await import("../../src/models/plugin-model.ts");
        const importedPluginComposition = await import("../../src/services/plugin-composition.ts");

        importedExporter.importFromFile(bundlePath, {
          embeddedTargetDir: importContext.projectDir,
        });

        const importedAlpha = importedPluginModel.getPlugin("alpha-only-plugin");
        const importedBeta = importedPluginModel.getPlugin("beta-no-plugin");
        if (!importedAlpha || !importedBeta) {
          throw new Error("expected imported plugins");
        }

        expect(importedPluginComposition.listAttachedPluginPins(importedAlpha.id)).toEqual([
          expect.objectContaining({ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }),
        ]);
        expect(importedPluginComposition.listAttachedPluginPins(importedBeta.id)).toEqual([]);
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("preserves per-plugin embedded plugin version constraints when refs are shared", async () => {
    const exportContext = await createInitializedTestContext("export-shared-ref-different-constraints");

    try {
      const pluginRoot = join(exportContext.projectDir, "plugins/shared-plugin");
      mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
      writeTextFile(
        join(pluginRoot, ".claude-plugin/plugin.json"),
        JSON.stringify({ version: "1.0.0", name: "shared-plugin" }),
      );

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const pluginPins = await import("../../src/services/plugin-composition.ts");
      const exporter = await loadPluginTransportServices();

      let alpha = pluginModel.createPlugin({ name: "alpha-shared-ref", version: "1.0.0" });
      let beta = pluginModel.createPlugin({ name: "beta-shared-ref", version: "1.0.0" });
      pluginPins.attachPluginPinToPlugin(alpha.id, "./plugins/shared-plugin", "^1.0.0");
      pluginPins.attachPluginPinToPlugin(beta.id, "./plugins/shared-plugin", "^2.0.0");
      alpha = getPlugin(cutHead(alpha.id, "1.17.0"))!;
      beta = getPlugin(cutHead(beta.id, "1.18.0"))!;

      const bundle = exporter.exportPlugin([alpha.id, beta.id], {
        projectRoot: exportContext.projectDir,
      });

      expect(bundle.embedded_plugins).toHaveLength(2);
      expect(bundle.plugins?.[0]?.plugin_pins).toContainEqual({
        ref: "./plugins/shared-plugin",
        version_constraint: "^1.0.0",
      });
      expect(bundle.plugins?.[1]?.plugin_pins).toContainEqual({
        ref: "./plugins/shared-plugin",
        version_constraint: "^2.0.0",
      });

      const bundlePath = join(exportContext.projectDir, "shared-ref-constraints.harnesstap.toml");
      exporter.exportToFile([alpha.id, beta.id], bundlePath, {
        projectRoot: exportContext.projectDir,
      });

      const importContext = await createInitializedTestContext("import-shared-ref-different-constraints");
      try {
        const importedExporter = await loadPluginTransportServices();
        const importedPluginModel = await import("../../src/models/plugin-model.ts");
        const importedPluginComposition = await import("../../src/services/plugin-composition.ts");

        importedExporter.importFromFile(bundlePath, {
          embeddedTargetDir: importContext.projectDir,
        });

        const importedAlpha = importedPluginModel.getPlugin("alpha-shared-ref");
        const importedBeta = importedPluginModel.getPlugin("beta-shared-ref");
        if (!importedAlpha || !importedBeta) {
          throw new Error("expected imported plugins");
        }

        expect(importedPluginComposition.listAttachedPluginPins(importedAlpha.id)).toEqual([
          expect.objectContaining({ ref: "./plugins/shared-plugin", version_constraint: "^1.0.0" }),
        ]);
        expect(importedPluginComposition.listAttachedPluginPins(importedBeta.id)).toEqual([
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
