import { describe, expect, it } from "bun:test";
import type { CatalogPlugin } from "../../src/services/catalog-types.js";
import { renderCatalogPluginShow } from "../../src/ui/catalog-list-render.ts";

const plugin: CatalogPlugin = {
  orgSlug: "harnesstap-cloud",
  catalogSlug: "default",
  slug: "data-engineer",
  name: "Data engineer",
  summary: "Antigravity data-engineering bundle",
  latestVersion: "1.0.0",
  updatedAt: "2026-01-12T00:00:00.000Z",
  tags: ["dbt", "airflow"],
  visibility: "public",
};

describe("renderCatalogPluginShow", () => {
  it("matches the plugin list show panel layout", () => {
    const output = renderCatalogPluginShow(plugin);

    expect(output).toContain("PLUGIN");
    expect(output).toContain("harnesstap-cloud/default/data-engineer@1.0.0");
    expect(output).toContain("Description");
    expect(output).toContain("Antigravity data-engineering bundle");
    expect(output).toContain("Tags");
    expect(output).toContain("dbt, airflow");
    expect(output).toContain("Updated");
    expect(output).not.toContain("Name:");
    expect(output).not.toContain("Visibility:");
  });
});
