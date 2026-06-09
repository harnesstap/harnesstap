import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createTestContext } from "../helpers/db.ts";
import { findPluginResourceByPin } from "../../src/services/composition-resource.ts";
import { syncPluginPinsForApply } from "../../src/services/plugin-apply-sync.ts";
import { createLayer } from "../../src/models/layer.ts";
import { addPluginToLayer } from "../../src/models/plugin-pins.ts";

const fixtureHome = join(import.meta.dirname, "../fixtures/claude-plugins-home");

describe("syncPluginPinsForApply", () => {
  it("resolves plugin versions from installed_plugins.json install paths", async () => {
    const context = await createTestContext("plugin-apply-sync-installed");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const layer = createLayer({ name: "sync-me" });
      addPluginToLayer(layer.id, "formatter@acme-marketplace", "1.2.3");

      await syncPluginPinsForApply({
        pins: [{ ref: "formatter@acme-marketplace", version_constraint: "1.2.3" }],
        homeRoot: fixtureHome,
      });

      const synced = findPluginResourceByPin("formatter@acme-marketplace", "1.2.3");
      expect((synced?.metadata as { resolved_version?: string }).resolved_version).toBe(
        "1.2.3",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("stamps exact version constraints when no local install exists", async () => {
    const context = await createTestContext("plugin-apply-sync-exact");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const layer = createLayer({ name: "catalog-layer" });
      addPluginToLayer(layer.id, "superpowers@obra", "5.1.0");

      await syncPluginPinsForApply({
        pins: [{ ref: "superpowers@obra", version_constraint: "5.1.0" }],
        homeRoot: context.homeDir,
      });

      const synced = findPluginResourceByPin("superpowers@obra", "5.1.0");
      expect((synced?.metadata as { resolved_version?: string }).resolved_version).toBe(
        "5.1.0",
      );
    } finally {
      await context.cleanup();
    }
  });
});
