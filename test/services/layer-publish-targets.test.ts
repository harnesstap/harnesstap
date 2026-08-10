import { describe, expect, it } from "bun:test";
import { registerPublishCatalog } from "../../src/config/catalog.js";
import { createLayer } from "../../src/models/plugin-model.js";
import {
  clearLayerPublishTargets,
  getLayerPublishBindingMode,
  listLayerPublishTargets,
  resolvePublishTargets,
  setLayerPublishTargets,
} from "../../src/services/layer-publish-targets.js";
import { createTestContext } from "../helpers/db.ts";

describe("layer publish targets", () => {
  it("defaults to all registered catalogs when allow list is empty", async () => {
    const context = await createTestContext("layer-publish-targets-default");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      registerPublishCatalog("acme/internal");
      registerPublishCatalog("acme/platform-personas");

      const layer = createLayer({ name: "default" });
      expect(getLayerPublishBindingMode(layer.id)).toBe("all_registered");
      expect(resolvePublishTargets(layer.id)).toEqual([
        { org: "acme", catalog: "internal" },
        { org: "acme", catalog: "platform-personas" },
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("uses explicit allow list when configured", async () => {
    const context = await createTestContext("layer-publish-targets-explicit");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      registerPublishCatalog("acme/internal");
      registerPublishCatalog("acme/platform-personas");

      const layer = createLayer({ name: "restricted" });
      setLayerPublishTargets(layer.id, [{ org: "acme", catalog: "internal" }]);
      expect(getLayerPublishBindingMode(layer.id)).toBe("explicit");
      expect(listLayerPublishTargets(layer.id)).toEqual([
        { org: "acme", catalog: "internal" },
      ]);
      expect(resolvePublishTargets(layer.id)).toEqual([
        { org: "acme", catalog: "internal" },
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("clearing allow list reverts to all registered catalogs", async () => {
    const context = await createTestContext("layer-publish-targets-clear");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      registerPublishCatalog("acme/internal");

      const layer = createLayer({ name: "clear-me" });
      setLayerPublishTargets(layer.id, [{ org: "acme", catalog: "internal" }]);
      clearLayerPublishTargets(layer.id);
      expect(listLayerPublishTargets(layer.id)).toEqual([]);
      expect(getLayerPublishBindingMode(layer.id)).toBe("all_registered");
    } finally {
      await context.cleanup();
    }
  });
});
