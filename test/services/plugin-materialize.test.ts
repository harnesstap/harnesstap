import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createTestContext } from "../helpers/db.ts";
import { findPluginResourceByPin } from "../../src/services/layer-composition.ts";
import { expandPluginMaterialResources } from "../../src/services/plugin-materialize.ts";
import { syncPluginPinsForApply } from "../../src/services/plugin-apply-sync.ts";
import { createLayer } from "../../src/models/layer-model.ts";
import { attachPluginPinToLayer } from "../../src/services/layer-composition.ts";

const fixtureHome = join(import.meta.dirname, "../fixtures/claude-plugins-home");

describe("expandPluginMaterialResources", () => {
  it("includes marketplace-linked skills from synced plugin install trees", async () => {
    const context = await createTestContext("plugin-materialize-expand");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const layer = createLayer({ name: "with-plugin-skills" });
      attachPluginPinToLayer(layer.id, "formatter@acme-marketplace", "1.2.3");

      await syncPluginPinsForApply({
        pins: [{ ref: "formatter@acme-marketplace", version_constraint: "1.2.3" }],
        homeRoot: fixtureHome,
        projectRoot: context.projectDir,
        scope: "project",
      });

      const plugin = findPluginResourceByPin("formatter@acme-marketplace", "1.2.3");
      expect(plugin).toBeDefined();

      const expanded = expandPluginMaterialResources([
        { ref: "formatter@acme-marketplace", version_constraint: "1.2.3" },
      ]);

      expect(expanded.some((resource) => resource.type === "skill" && resource.name === "format-code")).toBe(
        true,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("preserves existing layer resources when no plugin children are linked", () => {
    const base = {
      id: "01TEST",
      type: "instruction" as const,
      name: "project-context",
      description: "",
      content: "# Base",
      metadata: {},
      source: "test",
      namespace: "",
      origin_kind: "local_snapshot" as const,
      origin_ref: "",
      content_hash: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const expanded = expandPluginMaterialResources([], [base]);
    expect(expanded).toEqual([base]);
  });
});
