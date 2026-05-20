import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { writeTextFile } from "../helpers/fs.ts";

describe("CLI export and import", () => {
  it("exports and imports a preset bundle across isolated homes", async () => {
    const exportContext = await createTestContext("cli-export");

    try {
      await runCli(["init"]);

      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      const preset = presetModel.createPreset({ name: "bundle-preset" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "shared", content: "# Shared" }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const bundlePath = `${exportContext.projectDir}/bundle.json`;
      const exportResult = await runCli([
        "preset",
        "export",
        "bundle-preset",
        "--file",
        bundlePath,
      ]);

      expect(exportResult.stdout).toContain("Exported to");
      expect(existsSync(bundlePath)).toBe(true);

      const raw = JSON.parse(readFileSync(bundlePath, "utf-8"));
      expect(raw.version).toBe(2);
      expect(raw.plugins ?? []).toEqual([]);
      expect(raw.embedded_plugins ?? []).toEqual([]);

      const importContext = await createTestContext("cli-import");

      try {
        await runCli(["init"]);
        const importResult = await runCli(["preset", "import", bundlePath]);
        const importedPresetModel = await import("../../src/models/preset.ts");

        expect(importResult.stdout).toContain('Imported preset "bundle-preset"');
        expect(importedPresetModel.getPreset("bundle-preset")).toBeDefined();
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("preset export --embed-plugins inlines a resolvable Claude marketplace plugin", async () => {
    const context = await createTestContext("cli-export-embed");

    try {
      await runCli(["init"]);

      const claudePlug = join(context.homeDir, ".claude", "plugins");
      mkdirSync(claudePlug, { recursive: true });
      const installRel = "cache/acme-marketplace/fmt-cli";
      const plugRoot = join(claudePlug, installRel);
      mkdirSync(join(plugRoot, ".claude-plugin"), { recursive: true });
      writeTextFile(
        join(plugRoot, ".claude-plugin/plugin.json"),
        JSON.stringify({ version: "2.2.0" }),
      );
      writeTextFile(
        join(claudePlug, "installed_plugins.json"),
        JSON.stringify({
          plugins: {
            "fmt-cli@acme-marketplace": [
              {
                scope: "user",
                installPath: installRel,
                version: "2.2.0",
              },
            ],
          },
        }),
      );

      const presetModel = await import("../../src/models/preset.ts");
      const pluginModel = await import("../../src/models/plugin.ts");

      const preset = presetModel.createPreset({ name: "embed-flag" });
      pluginModel.addPluginToPreset(preset.id, "fmt-cli@acme-marketplace", "2.x");

      const bundlePath = join(context.projectDir, "embedded-cli.json");
      const exportResult = await runCli([
        "preset",
        "export",
        "embed-flag",
        "--embed-plugins",
        "--file",
        bundlePath,
      ]);

      expect(exportResult.stderr).not.toContain("ENOENT");
      expect(JSON.parse(readFileSync(bundlePath, "utf-8"))).toMatchObject({
        version: 2,
        embedded_plugins: expect.arrayContaining([
          expect.objectContaining({ ref: "fmt-cli@acme-marketplace" }),
        ]),
        plugins: [],
      });
    } finally {
      await context.cleanup();
    }
  });
});
