import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
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

      presetModel.deletePreset(preset.name);
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
});
