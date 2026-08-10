import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("plugin model", () => {
  it("round-trips plugin plugin rows", async () => {
    const context = await createInitializedTestContext("plugin-plugin-plugins");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const pinModel = await import("../../src/services/plugin-composition.ts");

      const plugin = pluginModel.createPlugin({ name: "with-plugins-row" });

      pinModel.attachPluginPinToPlugin(plugin.id, "@m/a", ">=1 <2");
      pinModel.attachPluginPinToPlugin(plugin.id, "@m/b", "=3.4.5", {
        embedOnExport: true,
      });
      pinModel.attachPluginPinToPlugin(plugin.id, "@m/c", "*");

      const rows = pinModel.listAttachedPluginPins(plugin.id);

      expect(rows).toHaveLength(3);

      expect(rows.find((r) => r.ref === "@m/a")).toMatchObject({
        ref: "@m/a",
        version_constraint: ">=1 <2",
        embed_on_export: false,
      });

      expect(rows.find((r) => r.ref === "@m/b")).toMatchObject({
        ref: "@m/b",
        version_constraint: "=3.4.5",
        embed_on_export: true,
      });

      pinModel.detachPluginPinFromPlugin(plugin.id, "@m/b");

      const afterRemove = pinModel.listAttachedPluginPins(plugin.id).map((r) => r.ref);
      expect(afterRemove).toEqual(expect.arrayContaining(["@m/a", "@m/c"]));
      expect(afterRemove).not.toContain("@m/b");
    } finally {
      await context.cleanup();
    }
  });
});
