import type { LibraryPluginHead } from "./api/library-plugins";
import type { CatalogPluginSearchHit, CatalogScope } from "./api/sources";
import type { MarketplaceSourceInput } from "./sources-search";
import type { LibraryResource, PluginMarketplaceEntry } from "./types";

export interface DiscoverMarketplaceHitCache {
  plugins: MarketplaceSourceInput["plugins"];
  error: string | null;
}

export interface DiscoverCatalogCacheSnapshot {
  marketplaces: PluginMarketplaceEntry[];
  scope: CatalogScope | null;
  marketplaceHits: Record<string, DiscoverMarketplaceHitCache>;
  localHeads: LibraryPluginHead[];
  localResources: LibraryResource[];
  localError: string | null;
  cloudPlugins: CatalogPluginSearchHit[];
  cloudErrors: Array<{ sourceLabel: string; message: string }>;
  fetchedSourceIds: string[];
  sourceInventoryReady: boolean;
}

const EMPTY_SNAPSHOT: DiscoverCatalogCacheSnapshot = {
  marketplaces: [],
  scope: null,
  marketplaceHits: {},
  localHeads: [],
  localResources: [],
  localError: null,
  cloudPlugins: [],
  cloudErrors: [],
  fetchedSourceIds: [],
  sourceInventoryReady: false,
};

let snapshot: DiscoverCatalogCacheSnapshot | null = null;

function cloneSnapshot(
  value: DiscoverCatalogCacheSnapshot,
): DiscoverCatalogCacheSnapshot {
  return {
    marketplaces: value.marketplaces.map((entry) => ({ ...entry })),
    scope: value.scope
      ? {
          ...value.scope,
          connectedOrgs: [...value.scope.connectedOrgs],
          registered: value.scope.registered.map((ref) => ({ ...ref })),
        }
      : null,
    marketplaceHits: Object.fromEntries(
      Object.entries(value.marketplaceHits).map(([id, hit]) => [
        id,
        {
          plugins: hit.plugins.map((plugin) => ({ ...plugin })),
          error: hit.error,
        },
      ]),
    ),
    localHeads: value.localHeads.map((head) => ({ ...head })),
    localResources: value.localResources.map((resource) => ({ ...resource })),
    localError: value.localError,
    cloudPlugins: value.cloudPlugins.map((plugin) => ({ ...plugin })),
    cloudErrors: value.cloudErrors.map((error) => ({ ...error })),
    fetchedSourceIds: [...value.fetchedSourceIds],
    sourceInventoryReady: value.sourceInventoryReady,
  };
}

export function readDiscoverCatalogCache(): DiscoverCatalogCacheSnapshot | null {
  return snapshot ? cloneSnapshot(snapshot) : null;
}

export function persistableDiscoverMarketplaceHits(
  hits: DiscoverCatalogCacheSnapshot["marketplaceHits"],
): DiscoverCatalogCacheSnapshot["marketplaceHits"] {
  return Object.fromEntries(
    Object.entries(hits).filter(
      ([, hit]) => hit.plugins.length > 0 || hit.error !== null,
    ),
  );
}

export function writeDiscoverCatalogCache(
  patch: Partial<DiscoverCatalogCacheSnapshot>,
): void {
  const base = snapshot ? cloneSnapshot(snapshot) : cloneSnapshot(EMPTY_SNAPSHOT);
  snapshot = cloneSnapshot({
    ...base,
    ...patch,
    marketplaceHits: persistableDiscoverMarketplaceHits(
      patch.marketplaceHits ? patch.marketplaceHits : base.marketplaceHits,
    ),
    fetchedSourceIds: patch.fetchedSourceIds
      ? [...patch.fetchedSourceIds]
      : base.fetchedSourceIds,
  });
}

export function clearDiscoverCatalogCache(): void {
  snapshot = null;
}
