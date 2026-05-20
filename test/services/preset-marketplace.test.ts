import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

describe("preset marketplace configuration", () => {
  it("round-trips claude config through export and import", async () => {
    const context = await createInitializedTestContext("preset-marketplace-export");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const exporter = await import("../../src/services/exporter.ts");

      const preset = presetModel.createPreset({
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

      const bundle = exporter.exportPreset(preset.id);

      expect(bundle.version).toBe(2);
      expect(bundle.claude?.marketplaces?.["team-plugins"]).toEqual({
        source: { source: "github", repo: "org/plugins" },
      });
      expect(bundle.claude?.plugins?.[0]?.id).toBe("fmt@team-plugins");

      const bundlePath = join(context.projectDir, "with-plugins.harnessdeck.json");
      exporter.exportToFile(preset.id, bundlePath);

      presetModel.deletePreset(preset.id);

      const imported = exporter.importFromFile(bundlePath);
      expect(imported.preset.claude?.plugins?.[0]?.version).toBe("2.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("applies marketplace config to claude settings.json", async () => {
    const context = await createInitializedTestContext("preset-marketplace-apply");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const applier = await import("../../src/services/applier.ts");

      const preset = presetModel.createPreset({
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
        preset.claude,
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
    const context = await createInitializedTestContext("preset-marketplace-import");

    try {
      const exporter = await import("../../src/services/exporter.ts");
      const presetModel = await import("../../src/models/preset.ts");

      const bundlePath = join(context.projectDir, "team-stack.harnessdeck.json");
      writeTextFile(
        bundlePath,
        JSON.stringify({
          $schema: "urn:harnessdeck:bundle:v1",
          version: 1,
          preset: {
            name: "team-stack",
            description: "Team Claude plugins",
            tags: ["team"],
          },
          claude: {
            marketplaces: {
              "team-plugins": {
                source: { source: "github", repo: "org/team-plugins" },
              },
            },
            plugins: [{ id: "review@team-plugins" }],
          },
          resources: [],
        }),
      );

      exporter.importFromFile(bundlePath);

      const preset = presetModel.getPreset("team-stack");
      expect(preset?.claude?.plugins?.[0]?.id).toBe("review@team-plugins");
    } finally {
      await context.cleanup();
    }
  });
});
