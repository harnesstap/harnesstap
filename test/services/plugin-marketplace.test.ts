import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import {
  makeSinglePluginExport,
  writePluginExportToml,
} from "../helpers/transport-fixtures.ts";

async function loadPluginTransportServices() {
  const [pluginExport, pluginImport] = await Promise.all([
    import("../../src/services/plugin-export.ts"),
    import("../../src/services/plugin-import.ts"),
  ]);
  return { ...pluginExport, ...pluginImport };
}

describe("plugin marketplace configuration", () => {
  it("round-trips claude config through export and import", async () => {
    const context = await createInitializedTestContext("plugin-marketplace-export");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const exporter = await loadPluginTransportServices();

      const plugin = pluginModel.createPlugin({
        name: "with-plugins",
        description: "Team plugin setup",
        claude: {
          marketplaces: {
            "team-plugins": {
              source: { source: "github", repo: "org/plugins" },
            },
          },
          plugins: [{ id: "fmt@team-plugins", version: "2.0.0" }],
        },
      });

      const bundle = exporter.exportPlugin(plugin.id);

      expect(bundle.version).toBe(1);
      expect(bundle.plugins[0]?.claude?.marketplaces?.["team-plugins"]).toEqual({
        source: { source: "github", repo: "org/plugins" },
      });
      expect(bundle.plugins[0]?.claude?.plugins?.[0]?.id).toBe("fmt@team-plugins");

      const bundlePath = join(context.projectDir, "with-plugins.harnesstap.toml");
      exporter.exportToFile(plugin.id, bundlePath);

      pluginModel.deletePlugin(plugin.id);

      const imported = exporter.importFromFile(bundlePath);
      expect(imported.plugin.claude?.plugins?.[0]?.version).toBe("2.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("applies marketplace config to claude settings.json", async () => {
    const context = await createInitializedTestContext("plugin-marketplace-apply");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const applier = await import("../../src/services/applier.ts");

      const plugin = pluginModel.createPlugin({
        name: "plugin-stack",
        claude: {
          marketplaces: {
            "acme-plugins": {
              source: { source: "github", repo: "acme/claude-plugins" },
            },
          },
          plugins: [{ id: "lint@acme-plugins", enabled: true }],
        },
      });

      const results = await applier.applyToProject(
        [],
        ["claude-code"],
        context.projectDir,
        plugin.claude,
      );

      const claudeFiles = results.find((result) => result.platformId === "claude-code")?.files;
      const settings = claudeFiles?.find((file) => file.path === ".claude/settings.json");
      expect(settings).toBeDefined();

      applier.writeFiles(claudeFiles ?? [], context.projectDir);

      const settingsPath = join(context.projectDir, ".claude", "settings.json");
      expect(existsSync(settingsPath)).toBe(true);

      const parsed = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
        extraKnownMarketplaces: Record<string, unknown>;
        enabledPlugins: Record<string, boolean>;
      };

      expect(parsed.extraKnownMarketplaces["acme-plugins"]).toEqual({
        source: { source: "github", repo: "acme/claude-plugins" },
      });
      expect(parsed.enabledPlugins["lint@acme-plugins"]).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("imports claude config from a bundle file", async () => {
    const context = await createInitializedTestContext("plugin-marketplace-import");

    try {
      const exporter = await loadPluginTransportServices();
      const pluginModel = await import("../../src/models/plugin-model.ts");

      const bundlePath = join(context.projectDir, "team-stack.harnesstap.toml");
      writePluginExportToml(
        bundlePath,
        makeSinglePluginExport({
          name: "team-stack",
          description: "Team Claude plugins",
          tags: ["team"],
          claude: {
            marketplaces: {
              "team-plugins": {
                source: { source: "github", repo: "org/team-plugins" },
              },
            },
            plugins: [{ id: "review@team-plugins" }],
          },
        }),
      );

      exporter.importFromFile(bundlePath);

      const plugin = pluginModel.getPlugin("team-stack");
      expect(plugin?.claude?.plugins?.[0]?.id).toBe("review@team-plugins");
    } finally {
      await context.cleanup();
    }
  });
});
