import { afterEach, describe, expect, test } from "bun:test";
import {
  clearDiscoverCatalogCache,
  persistableDiscoverMarketplaceHits,
  readDiscoverCatalogCache,
  writeDiscoverCatalogCache,
} from "../../apps/desktop/src/lib/discover-catalog-cache.ts";

afterEach(() => {
  clearDiscoverCatalogCache();
});

describe("discover catalog session cache", () => {
  test("starts empty and hydrates after write-through", () => {
    expect(readDiscoverCatalogCache()).toBeNull();
    writeDiscoverCatalogCache({
      marketplaces: [
        { name: "acme", url: "https://example.com/acme.git", platforms: [] },
      ],
      scope: {
        defaultOrg: "harnesstap-cloud",
        publicCatalog: true,
        connectedOrgs: [],
        registered: [],
      },
      marketplaceHits: {
        "mkt:acme": {
          plugins: [{ name: "focus" }],
          error: null,
        },
      },
      fetchedSourceIds: ["mkt:acme"],
      sourceInventoryReady: true,
    });
    const cached = readDiscoverCatalogCache();
    expect(cached?.marketplaces[0]?.name).toBe("acme");
    expect(cached?.marketplaceHits["mkt:acme"]?.plugins[0]?.name).toBe("focus");
    expect(cached?.fetchedSourceIds).toEqual(["mkt:acme"]);
    expect(cached?.sourceInventoryReady).toBe(true);
  });

  test("merges later writes without dropping earlier marketplace hits", () => {
    writeDiscoverCatalogCache({
      marketplaceHits: {
        "mkt:acme": { plugins: [{ name: "focus" }], error: null },
      },
      fetchedSourceIds: ["mkt:acme"],
    });
    writeDiscoverCatalogCache({
      marketplaceHits: {
        "mkt:acme": { plugins: [{ name: "focus" }], error: null },
        "mkt:beta": { plugins: [{ name: "notes" }], error: null },
      },
      fetchedSourceIds: ["mkt:acme", "mkt:beta"],
    });
    const cached = readDiscoverCatalogCache();
    expect(Object.keys(cached?.marketplaceHits ?? {})).toEqual([
      "mkt:acme",
      "mkt:beta",
    ]);
    expect(cached?.fetchedSourceIds).toEqual(["mkt:acme", "mkt:beta"]);
  });

  test("returns a copy so callers cannot mutate the stored snapshot", () => {
    writeDiscoverCatalogCache({
      marketplaces: [
        { name: "acme", url: "https://example.com/acme.git", platforms: [] },
      ],
      marketplaceHits: {
        "mkt:acme": { plugins: [{ name: "focus" }], error: null },
      },
      fetchedSourceIds: ["mkt:acme"],
    });
    const first = readDiscoverCatalogCache();
    first?.marketplaces.push({
      name: "mutated",
      url: "https://example.com/mutated.git",
      platforms: [],
    });
    first?.fetchedSourceIds.push("mkt:mutated");
    expect(readDiscoverCatalogCache()?.marketplaces).toHaveLength(1);
    expect(readDiscoverCatalogCache()?.fetchedSourceIds).toEqual(["mkt:acme"]);
  });

  test("does not persist empty unfetched marketplace hits as a complete catalog", () => {
    expect(
      persistableDiscoverMarketplaceHits({
        "mkt:acme": { plugins: [{ name: "focus" }], error: null },
        "mkt:pending": { plugins: [], error: null },
        "mkt:failed": { plugins: [], error: "Could not load beta." },
      }),
    ).toEqual({
      "mkt:acme": { plugins: [{ name: "focus" }], error: null },
      "mkt:failed": { plugins: [], error: "Could not load beta." },
    });
    writeDiscoverCatalogCache({
      marketplaceHits: {
        "mkt:acme": { plugins: [{ name: "focus" }], error: null },
        "mkt:pending": { plugins: [], error: null },
      },
      fetchedSourceIds: ["mkt:acme", "mkt:pending"],
    });
    expect(Object.keys(readDiscoverCatalogCache()?.marketplaceHits ?? {})).toEqual([
      "mkt:acme",
    ]);
  });
});
