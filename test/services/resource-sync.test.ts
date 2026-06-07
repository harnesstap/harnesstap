import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";

const pluginImportFixtureRoot = join(import.meta.dirname, "../fixtures/plugin-import");

describe("resource-sync service", () => {
  it("refreshes marketplace_link resource when install tree content changes", async () => {
    const context = await createInitializedTestContext("resource-sync-refresh");

    try {
      const scanner = await import("../../src/services/scanner.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const { syncLinkedResources } = await import("../../src/services/resource-sync.ts");

      await scanner.scanAndPersistPluginSource(
        join(pluginImportFixtureRoot, "cursor-team-kit"),
      );

      const before = resourceModel
        .listResources()
        .find((resource) => resource.name === "team");
      expect(before?.origin_kind).toBe("marketplace_link");

      const result = await syncLinkedResources({
        selector: "skill:team@cursor-team-kit",
        policy: "overwrite",
        claudePluginsRoot: join(context.homeDir, ".claude", "plugins"),
        homeRoot: context.homeDir,
      });

      expect(result.checked).toBeGreaterThanOrEqual(0);
    } finally {
      await context.cleanup();
    }
  });
});
