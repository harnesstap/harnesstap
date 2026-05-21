import { describe, expect, it } from "vitest";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { PluginInstall } from "../../src/plugins/types.js";

describe("plugin model", () => {
  const sampleCommitted: PluginInstall[] = [
    {
      ref: "@scope/demo-format",
      platformId: "claude-code",
      name: "demo-format",
      version: "1.0.0",
      versionSource: "manifest",
      scope: "user",
      enabled: true,
    },
  ];

  const sampleEffective: PluginInstall[] = [
    {
      ref: "@scope/demo-format",
      platformId: "claude-code",
      name: "demo-format",
      version: "1.0.0",
      versionSource: "manifest",
      scope: "user",
      enabled: true,
    },
    {
      ref: "local/security",
      platformId: "claude-code",
      name: "security",
      version: "0.9.2",
      versionSource: "git_sha",
      scope: "project",
      enabled: false,
      installPath: "/tmp/repo/plugins/security",
    },
  ];

  it("upserts and reads project plugin inventory", async () => {
    const context = await createInitializedTestContext("plugin-project-state");

    try {
      const projectModel = await import("../../src/models/project.ts");
      const pluginModel = await import("../../src/models/plugin.ts");

      const project = projectModel.createProject({
        git_origin: "git@github.com:acme/with-plugins.git",
        name: "acme/with-plugins",
        local_path: "/tmp/with-plugins",
      });

      const inventory = {
        scanned_at: new Date().toISOString(),
        committed: sampleCommitted,
        effective: sampleEffective,
      };

      pluginModel.upsertProjectPluginState(project.id, inventory);

      expect(pluginModel.getProjectPluginState(project.id)).toEqual(inventory);
      expect(pluginModel.getProjectPluginState(project.id, "claude-code")).toEqual(
        inventory,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("round-trips preset plugin rows", async () => {
    const context = await createInitializedTestContext("plugin-preset-plugins");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const pluginModel = await import("../../src/models/plugin.ts");

      const preset = presetModel.createPreset({ name: "with-plugins-row" });

      pluginModel.addPluginToPreset(preset.id, "@m/a", ">=1 <2");
      pluginModel.addPluginToPreset(preset.id, "@m/b", "=3.4.5", {
        embedOnExport: true,
      });
      pluginModel.addPluginToPreset(preset.id, "@m/c", "*");

      const rows = pluginModel.listPresetPlugins(preset.id);

      expect(rows).toHaveLength(3);

      expect(rows.find((r) => r.ref === "@m/a")).toMatchObject({
        preset_id: preset.id,
        ref: "@m/a",
        version_constraint: ">=1 <2",
        embed_on_export: false,
      });

      expect(rows.find((r) => r.ref === "@m/b")).toMatchObject({
        preset_id: preset.id,
        ref: "@m/b",
        version_constraint: "=3.4.5",
        embed_on_export: true,
      });

      expect(rows.map((r) => r.order)).toEqual(expect.arrayContaining([0, 1, 2]));

      pluginModel.removePluginFromPreset(preset.id, "@m/b");

      const afterRemove = pluginModel.listPresetPlugins(preset.id).map((r) => r.ref);
      expect(afterRemove).toEqual(expect.arrayContaining(["@m/a", "@m/c"]));
      expect(afterRemove).not.toContain("@m/b");
    } finally {
      await context.cleanup();
    }
  });
});
