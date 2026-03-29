import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

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
      const exportResult = await runCli(["export", "bundle-preset", "--file", bundlePath]);

      expect(exportResult.stdout).toContain("Exported to");
      expect(existsSync(bundlePath)).toBe(true);

      const importContext = await createTestContext("cli-import");

      try {
        await runCli(["init"]);
        const importResult = await runCli(["import", bundlePath]);
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
});
