import { describe, expect, it } from "bun:test";
import type { CatalogPlugin } from "../../src/services/catalog-types.js";
import {
  catalogSearchRank,
  rankCatalogSearchResults,
} from "../../src/services/catalog-search-rank.js";

function makePlugin(
  overrides: Partial<CatalogPlugin> & Pick<CatalogPlugin, "slug">,
): CatalogPlugin {
  return {
    orgSlug: "harnesstap-cloud",
    catalogSlug: "default",
    name: overrides.slug,
    summary: "",
    latestVersion: "1.0.0",
    updatedAt: "2026-01-01T00:00:00.000Z",
    tags: [],
    visibility: "public",
    ...overrides,
  };
}

describe("catalog search ranking", () => {
  it("ranks exact slug matches ahead of tag and summary matches", () => {
    const plugins = [
      makePlugin({
        slug: "devops-engineer",
        summary: "fullstack DevOps coverage",
        tags: ["fullstack"],
        updatedAt: "2026-06-01T00:00:00.000Z",
      }),
      makePlugin({
        slug: "engineering-foundation",
        name: "Engineering foundation",
        summary: "Shared baseline",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ];

    const ranked = rankCatalogSearchResults(plugins, "engineering-foundation");
    expect(ranked[0]?.slug).toBe("engineering-foundation");
  });

  it("ranks foundation search with engineering-foundation before partial tag hits", () => {
    const plugins = [
      makePlugin({
        slug: "data-engineer",
        name: "Data engineer",
        tags: ["engineering"],
      }),
      makePlugin({
        slug: "engineering-foundation",
        name: "Engineering foundation",
      }),
      makePlugin({
        slug: "ml-engineer",
        name: "ML engineer",
        summary: "foundation models",
      }),
    ];

    const ranked = rankCatalogSearchResults(plugins, "foundation");
    expect(ranked[0]?.slug).toBe("engineering-foundation");
  });

  it("assigns lower rank to exact slug than slug prefix", () => {
    const exact = makePlugin({ slug: "team" });
    const prefix = makePlugin({ slug: "team-stack" });
    expect(catalogSearchRank(exact, "team")).toBeLessThan(
      catalogSearchRank(prefix, "team"),
    );
  });
});
