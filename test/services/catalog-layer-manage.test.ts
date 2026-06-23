import { describe, expect, it } from "bun:test";
import type { CatalogLayer } from "../../src/services/catalog-types.js";
import {
  findLocalLayerForCatalogEntry,
  isCatalogLayerManageable,
} from "../../src/services/catalog-layer-manage.js";
import { getDb } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";
import { createLayer } from "../../src/models/layer-model.js";
import { createTestContext } from "../helpers/db.ts";

const catalogLayer: CatalogLayer = {
  orgSlug: "acme",
  catalogSlug: "default",
  slug: "team-stack",
  name: "Team Stack",
  summary: "Team baseline",
  latestVersion: "1.0.0",
  updatedAt: "2026-01-03T00:00:00.000Z",
  tags: [],
  visibility: "organization",
  layerId: "remote-layer-1",
  orgId: "org-acme",
  manageable: true,
};

describe("catalog layer manage helpers", () => {
  it("detects manageable catalog layers", () => {
    expect(isCatalogLayerManageable(catalogLayer)).toBe(true);
    expect(isCatalogLayerManageable({ ...catalogLayer, manageable: false })).toBe(false);
    expect(isCatalogLayerManageable({ ...catalogLayer, layerId: undefined })).toBe(false);
  });

  it("finds a local layer linked to a catalog entry", async () => {
    const context = await createTestContext("catalog-layer-manage-find-local");
    try {
      initializeSchema(getDb());
      const layer = createLayer({
        name: "team-stack",
        version: "1.0.0",
        org_slug: "acme",
        catalog_slug: "default",
      });
      expect(findLocalLayerForCatalogEntry(catalogLayer)?.id).toBe(layer.id);
    } finally {
      await context.cleanup();
    }
  });
});
