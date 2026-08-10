import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createPlugin, updatePluginPublishedIdentity } from "../../src/models/plugin-model.ts";
import {
  assertInstallPluginNameAvailable,
  findInstallNameConflict,
} from "../../src/services/plugin-install-conflicts.ts";

describe("plugin install conflicts", () => {
  it("allows installing another version of the same published identity", async () => {
    const context = await createInitializedTestContext("install-same-identity");
    try {
      const plugin = createPlugin({ name: "team", version: "1.0.0" });
      updatePluginPublishedIdentity(plugin.id, {
        org_slug: "acme",
        catalog_slug: "default",
        version: "1.0.0",
      });

      const conflict = findInstallNameConflict(
        {
          org_slug: "acme",
          catalog_slug: "default",
          plugin_slug: "team",
          version: "2.0.0",
        },
        {},
      );

      expect(conflict).toBeUndefined();
      expect(() =>
        assertInstallPluginNameAvailable(
          {
            org_slug: "acme",
            catalog_slug: "default",
            plugin_slug: "team",
            version: "2.0.0",
          },
          {},
        ),
      ).not.toThrow();
    } finally {
      await context.cleanup();
    }
  });

  it("blocks install when local name is used by a different published identity", async () => {
    const context = await createInitializedTestContext("install-diff-identity");
    try {
      const plugin = createPlugin({ name: "team", version: "1.0.0" });
      updatePluginPublishedIdentity(plugin.id, {
        org_slug: "other",
        catalog_slug: "default",
        version: "1.0.0",
      });

      expect(() =>
        assertInstallPluginNameAvailable(
          {
            org_slug: "acme",
            catalog_slug: "default",
            plugin_slug: "team",
            version: "1.0.0",
          },
          {},
        ),
      ).toThrow(/published as other\/default\/team/);
    } finally {
      await context.cleanup();
    }
  });
});
