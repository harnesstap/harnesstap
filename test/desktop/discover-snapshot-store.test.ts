import { describe, expect, it } from "bun:test";
import type { LibraryInventoryResult } from "../../apps/desktop/src/lib/api/library-inventory.ts";
import type { CatalogScope } from "../../apps/desktop/src/lib/api/sources.ts";
import type { LibraryListEntry } from "../../apps/desktop/src/lib/library-list.ts";
import { DISCOVER_MARKETPLACE_HIT_SCHEMA } from "../../apps/desktop/src/lib/sources-search.ts";
import type {
  MarketplaceListResult,
  MarketplacePluginsResult,
} from "../../apps/desktop/src/lib/types.ts";
import {
  createDiscoverSnapshotStore,
  type DiscoverSnapshotFetchers,
} from "../../apps/desktop/src/state/discover-snapshot-store.ts";
import {
  createLibrarySnapshotStore,
  type LibrarySnapshotFetchers,
} from "../../apps/desktop/src/state/library-snapshot-store.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function unused(): never {
  throw new Error("not used in this test");
}

function pluginPackage(name: string): LibraryListEntry {
  return {
    listKind: "plugin-package",
    id: `pkg:${name}`,
    name,
    type: "plugin",
    namespace: null,
    description: `${name} plugin`,
    version: "1.2.0",
    pluginOrigin: "catalog",
    tags: ["ops"],
    originOutdated: false,
  };
}

function skillResource(name: string): LibraryListEntry {
  return {
    listKind: "resource",
    id: `res:${name}`,
    name,
    type: "skill",
    namespace: null,
    description: `${name} skill`,
    originOutdated: false,
  };
}

function inventory(rows: LibraryListEntry[]): LibraryInventoryResult {
  return {
    rows,
    total: rows.length,
    type_counts: { plugin: 1, skill: 1 },
    offset: 0,
  };
}

function marketplacesResult(
  names: string[] = ["acme"],
): MarketplaceListResult {
  return {
    marketplaces: names.map((name) => ({
      name,
      url: `https://example.com/${name}.git`,
      platforms: [],
    })),
    marketplaceRefreshMaxAgeMinutes: 60,
  };
}

function catalogScope(): CatalogScope {
  return {
    defaultOrg: "harnesstap-cloud",
    publicCatalog: true,
    connectedOrgs: [],
    registered: [],
  };
}

function pluginsResult(
  marketplace: string,
  pluginName: string,
): MarketplacePluginsResult {
  return {
    marketplace,
    plugins: [{ name: pluginName, ref: `${marketplace}/${pluginName}` }],
  };
}

async function seededLibrary(
  rows: LibraryListEntry[],
  fetchInventory: LibrarySnapshotFetchers["fetchInventory"] = async () =>
    inventory(rows),
) {
  const library = createLibrarySnapshotStore({ fetchInventory });
  library.setClient({ baseUrl: "http://127.0.0.1:7474", token: "t" });
  await library.loadPeek();
  return library;
}

function storeWith(
  overrides: Partial<DiscoverSnapshotFetchers> & {
    library?: Awaited<ReturnType<typeof seededLibrary>>;
  } = {},
) {
  const fetchers: DiscoverSnapshotFetchers = {
    fetchMarketplaces: overrides.fetchMarketplaces
      ?? (async () => marketplacesResult()),
    fetchCatalogScope: overrides.fetchCatalogScope ?? (async () => catalogScope()),
    fetchMarketplacePlugins: overrides.fetchMarketplacePlugins
      ?? (() => Promise.reject(new Error("marketplace plugins fetcher"))),
  };
  const store = createDiscoverSnapshotStore(fetchers, overrides.library);
  store.setClient({ baseUrl: "http://127.0.0.1:7474", token: "t" });
  return store;
}

describe("discover snapshot store", () => {
  it("loadSources does not call marketplace plugins and syncs local from library peek", async () => {
    let pluginFetches = 0;
    const library = await seededLibrary([
      pluginPackage("focus"),
      skillResource("ship"),
    ]);
    const store = storeWith({
      library,
      fetchMarketplacePlugins: async () => {
        pluginFetches += 1;
        return pluginsResult("acme", "focus");
      },
    });

    await store.loadSources();

    expect(pluginFetches).toBe(0);
    expect(store.getState().marketplaces.map((entry) => entry.name)).toEqual([
      "acme",
    ]);
    expect(store.getState().scope?.defaultOrg).toBe("harnesstap-cloud");
    expect(store.getState().localHeads).toEqual([
      {
        id: "pkg:focus",
        name: "focus",
        version: "1.2.0",
        description: "focus plugin",
        origin: "catalog",
        tags: ["ops"],
        dirty: false,
        org_slug: "",
        catalog_slug: "",
      },
    ]);
    expect(store.getState().localResources).toEqual([
      {
        id: "res:ship",
        name: "ship",
        type: "skill",
        namespace: null,
        description: "ship skill",
      },
    ]);
  });

  it("warm loads sources then fills marketplace catalogs", async () => {
    let pluginFetches = 0;
    const library = await seededLibrary([pluginPackage("focus")]);
    const store = storeWith({
      library,
      fetchMarketplaces: async () => marketplacesResult(["acme", "tools"]),
      fetchMarketplacePlugins: async (_baseUrl, _token, name) => {
        pluginFetches += 1;
        return pluginsResult(name, `${name}-plugin`);
      },
    });

    await store.warm();

    expect(pluginFetches).toBe(2);
    expect(store.getState().marketplaceHits["mkt:acme"]?.plugins[0]?.name).toBe(
      "acme-plugin",
    );
    expect(store.getState().marketplaceHits["mkt:tools"]?.plugins[0]?.name).toBe(
      "tools-plugin",
    );
  });

  it("loadFillIn is the only method that fetches marketplace plugins", async () => {
    let pluginFetches = 0;
    const library = await seededLibrary([pluginPackage("focus")]);
    const store = storeWith({
      library,
      fetchMarketplacePlugins: async (_baseUrl, _token, name) => {
        pluginFetches += 1;
        return pluginsResult(name, "notes");
      },
    });

    await store.loadSources();
    expect(pluginFetches).toBe(0);

    store.syncLocalFromLibraryPeek();
    await store.invalidate();
    expect(pluginFetches).toBe(0);

    await store.loadFillIn(["mkt:acme"]);
    expect(pluginFetches).toBe(1);
    expect(store.getState().marketplaceHits["mkt:acme"]?.plugins[0]?.name).toBe(
      "notes",
    );
    expect(store.getState().marketplaceHits["mkt:acme"]?.schema).toBe(
      DISCOVER_MARKETPLACE_HIT_SCHEMA,
    );
  });

  it("invalidate drops a stale marketplace fill-in response", async () => {
    const first = deferred<MarketplacePluginsResult>();
    const second = deferred<MarketplacePluginsResult>();
    const calls: Deferred<MarketplacePluginsResult>[] = [first, second];
    const library = await seededLibrary([pluginPackage("focus")]);
    const store = storeWith({
      library,
      fetchMarketplacePlugins: () => calls.shift()?.promise ?? unused(),
    });

    await store.loadSources();
    const pendingFill = store.loadFillIn(["mkt:acme"]);
    const invalidateDone = store.invalidate();

    first.resolve(pluginsResult("acme", "stale"));
    await pendingFill;

    expect(store.getState().marketplaceHits["mkt:acme"]?.plugins[0]?.name).not.toBe(
      "stale",
    );
    expect(store.getState().generation).toBeGreaterThan(0);

    second.resolve(pluginsResult("acme", "fresh"));
    await invalidateDone;
    expect(store.getState().marketplaceHits["mkt:acme"]?.plugins[0]?.name).toBe(
      "fresh",
    );
  });
});
