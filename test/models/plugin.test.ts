import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("plugin model", () => {
  it("round-trips layer plugin rows", async () => {
    const context = await createInitializedTestContext("plugin-layer-plugins");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const pinModel = await import("../../src/services/layer-composition.ts");

      const layer = layerModel.createLayer({ name: "with-plugins-row" });

      pinModel.attachPluginPinToLayer(layer.id, "@m/a", ">=1 <2");
      pinModel.attachPluginPinToLayer(layer.id, "@m/b", "=3.4.5", {
        embedOnExport: true,
      });
      pinModel.attachPluginPinToLayer(layer.id, "@m/c", "*");

      const rows = pinModel.listLayerPlugins(layer.id);

      expect(rows).toHaveLength(3);

      expect(rows.find((r) => r.ref === "@m/a")).toMatchObject({
        layer_id: layer.id,
        ref: "@m/a",
        version_constraint: ">=1 <2",
        embed_on_export: false,
      });

      expect(rows.find((r) => r.ref === "@m/b")).toMatchObject({
        layer_id: layer.id,
        ref: "@m/b",
        version_constraint: "=3.4.5",
        embed_on_export: true,
      });

      expect(rows.map((r) => r.order)).toEqual(expect.arrayContaining([0, 1, 2]));

      pinModel.detachPluginPinFromLayer(layer.id, "@m/b");

      const afterRemove = pinModel.listLayerPlugins(layer.id).map((r) => r.ref);
      expect(afterRemove).toEqual(expect.arrayContaining(["@m/a", "@m/c"]));
      expect(afterRemove).not.toContain("@m/b");
    } finally {
      await context.cleanup();
    }
  });
});
