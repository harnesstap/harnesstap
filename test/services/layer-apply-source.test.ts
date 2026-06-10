import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";
import { resolveApplyLayerSource } from "../../src/services/layer-apply-source.ts";

describe("resolveApplyLayerSource", () => {
  it("installs a published selector from the catalog when missing locally", async () => {
    const context = await createInitializedTestContext("resolve-apply-layer-source-remote");
    try {
      const cloudProfiles = await import("../../src/config/cloud-profiles.ts");
      await cloudProfiles.saveCloudProfile("test", {
        cloudBaseUrl: "https://mock",
        accessToken: "tok",
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
        refreshToken: "r",
        scopes: [],
      });
      await cloudProfiles.setDefaultCloudProfile("test");

      const restoreFetch = createCatalogFetchMock({ baseUrl: "https://mock" });
      const fetchedLabels: string[] = [];

      const resolved = await resolveApplyLayerSource("harnessdeck-cloud/team@1.0", {
        onFetched: (label) => fetchedLabels.push(label),
      });

      expect(resolved).toEqual({ kind: "local", layerId: expect.any(String) });
      expect(fetchedLabels).toEqual(["harnessdeck-cloud/team@1.0"]);

      const second = await resolveApplyLayerSource("harnessdeck-cloud/team@1.0");
      expect(second).toEqual(resolved);

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("rejects unpublished selectors that are missing locally", async () => {
    const context = await createInitializedTestContext("resolve-apply-layer-source-missing");
    try {
      await expect(resolveApplyLayerSource("missing-local-layer")).rejects.toThrow(
        "Layer not found: missing-local-layer",
      );
    } finally {
      await context.cleanup();
    }
  });
});
