import { describe, expect, it } from "bun:test";
import { registerPublishCatalog } from "../../src/config/catalog.js";
import { createPlugin } from "../../src/models/plugin-model.js";
import {
  clearPluginPublishTargets,
  getPluginPublishBindingMode,
  listPluginPublishTargets,
  resolvePublishTargets,
  setPluginPublishTargets,
} from "../../src/services/plugin-publish-targets.js";
import { createTestContext } from "../helpers/db.ts";

describe("plugin publish targets", () => {
  it("defaults to all registered catalogs when allow list is empty", async () => {
    const context = await createTestContext("plugin-publish-targets-default");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      registerPublishCatalog("acme/internal");
      registerPublishCatalog("acme/platform-personas");

      const plugin = createPlugin({ name: "default" });
      expect(getPluginPublishBindingMode(plugin.id)).toBe("all_registered");
      expect(resolvePublishTargets(plugin.id)).toEqual([
        { org: "acme", catalog: "internal" },
        { org: "acme", catalog: "platform-personas" },
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("uses explicit allow list when configured", async () => {
    const context = await createTestContext("plugin-publish-targets-explicit");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      registerPublishCatalog("acme/internal");
      registerPublishCatalog("acme/platform-personas");

      const plugin = createPlugin({ name: "restricted" });
      setPluginPublishTargets(plugin.id, [{ org: "acme", catalog: "internal" }]);
      expect(getPluginPublishBindingMode(plugin.id)).toBe("explicit");
      expect(listPluginPublishTargets(plugin.id)).toEqual([
        { org: "acme", catalog: "internal" },
      ]);
      expect(resolvePublishTargets(plugin.id)).toEqual([
        { org: "acme", catalog: "internal" },
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("clearing allow list reverts to all registered catalogs", async () => {
    const context = await createTestContext("plugin-publish-targets-clear");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      registerPublishCatalog("acme/internal");

      const plugin = createPlugin({ name: "clear-me" });
      setPluginPublishTargets(plugin.id, [{ org: "acme", catalog: "internal" }]);
      clearPluginPublishTargets(plugin.id);
      expect(listPluginPublishTargets(plugin.id)).toEqual([]);
      expect(getPluginPublishBindingMode(plugin.id)).toBe("all_registered");
    } finally {
      await context.cleanup();
    }
  });
});
