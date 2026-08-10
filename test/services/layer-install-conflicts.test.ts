import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createLayer, updateLayerPublishedIdentity } from "../../src/models/plugin-model.ts";
import {
  assertInstallLayerNameAvailable,
  findInstallNameConflict,
} from "../../src/services/layer-install-conflicts.ts";

describe("layer install conflicts", () => {
  it("allows installing another version of the same published identity", async () => {
    const context = await createInitializedTestContext("install-same-identity");
    try {
      const layer = createLayer({ name: "team", version: "1.0.0" });
      updateLayerPublishedIdentity(layer.id, {
        org_slug: "acme",
        catalog_slug: "default",
        version: "1.0.0",
      });

      const conflict = findInstallNameConflict(
        {
          org_slug: "acme",
          catalog_slug: "default",
          layer_slug: "team",
          version: "2.0.0",
        },
        {},
      );

      expect(conflict).toBeUndefined();
      expect(() =>
        assertInstallLayerNameAvailable(
          {
            org_slug: "acme",
            catalog_slug: "default",
            layer_slug: "team",
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
      const layer = createLayer({ name: "team", version: "1.0.0" });
      updateLayerPublishedIdentity(layer.id, {
        org_slug: "other",
        catalog_slug: "default",
        version: "1.0.0",
      });

      expect(() =>
        assertInstallLayerNameAvailable(
          {
            org_slug: "acme",
            catalog_slug: "default",
            layer_slug: "team",
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
