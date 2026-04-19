import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createInitializedTestContext } from "../helpers/db.ts";
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

      expect(bundle.$schema).toBe("https://skilldeck.dev/bundle-v1.json");
      expect(bundle.version).toBe(1);
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
});
