import { describe, expect, it } from "bun:test";
import type { CatalogLayer } from "../../src/services/catalog-types.js";
import { renderCatalogLayerShow } from "../../src/ui/catalog-list-render.ts";

const layer: CatalogLayer = {
  orgSlug: "harnessdeck-cloud",
  catalogSlug: "default",
  slug: "data-engineer",
  name: "Data engineer",
  summary: "Antigravity data-engineering bundle",
  latestVersion: "1.0.0",
  updatedAt: "2026-01-12T00:00:00.000Z",
  tags: ["dbt", "airflow"],
  visibility: "public",
};

describe("renderCatalogLayerShow", () => {
  it("matches the layer list show panel layout", () => {
    const output = renderCatalogLayerShow(layer);

    expect(output).toContain("LAYER");
    expect(output).toContain("harnessdeck-cloud/default/data-engineer@1.0.0");
    expect(output).toContain("Description");
    expect(output).toContain("Antigravity data-engineering bundle");
    expect(output).toContain("Tags");
    expect(output).toContain("dbt, airflow");
    expect(output).toContain("Updated");
    expect(output).not.toContain("Name:");
    expect(output).not.toContain("Visibility:");
  });
});
