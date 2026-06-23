import { afterEach, describe, expect, it } from "bun:test";
import { listLayers } from "../../src/models/layer-model.js";
import { renderCatalogLayerPreviewShow } from "../../src/services/catalog-layer-preview.js";
import type { CatalogLayer } from "../../src/services/catalog-types.js";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

const catalogLayer: CatalogLayer = {
  orgSlug: "harnessdeck-cloud",
  catalogSlug: "default",
  slug: "remote-team",
  name: "Remote team",
  summary: "from cloud",
  latestVersion: "1.0.0",
  updatedAt: "2026-01-03T00:00:00.000Z",
  tags: ["team"],
  visibility: "public",
};

describe("renderCatalogLayerPreviewShow", () => {
  let restoreFetch: (() => void) | undefined;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  it("renders full layer show output without keeping a preview install", async () => {
    const context = await createInitializedTestContext("catalog-layer-preview");
    restoreFetch = createCatalogFetchMock({
      baseUrl: "https://harnessdeck.kayrnt.fr",
      layers: [catalogLayer],
    });

    try {
      const beforeCount = listLayers().length;
      const output = await renderCatalogLayerPreviewShow(catalogLayer, {
        baseUrl: "https://harnessdeck.kayrnt.fr",
      });

      expect(output).toContain("LAYER");
      expect(output).toContain("harnessdeck-cloud/default/remote-team@1.0.0");
      expect(output).toContain("from cloud");
      expect(output).toContain("RESOURCES");
      expect(output).toContain("instruction");
      expect(listLayers()).toHaveLength(beforeCount);
      expect(listLayers().every((layer) => !layer.name.startsWith("__hd-preview-"))).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
