import {
  discoverSnapshotStore,
  persistableDiscoverMarketplaceHits,
  type DiscoverCatalogCacheSnapshot,
  type DiscoverMarketplaceHitCache,
} from "../state/discover-snapshot-store";

export type { DiscoverCatalogCacheSnapshot, DiscoverMarketplaceHitCache };
export { persistableDiscoverMarketplaceHits };

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
          ...(hit.schema !== undefined ? { schema: hit.schema } : {}),
          ...(hit.fetchedAt !== undefined ? { fetchedAt: hit.fetchedAt } : {}),
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
  const state = discoverSnapshotStore.getState();
  if (!state.hydrated) {
    return null;
  }
  return cloneSnapshot({
    marketplaces: state.marketplaces,
    scope: state.scope,
    marketplaceHits: state.marketplaceHits,
    localHeads: state.localHeads,
    localResources: state.localResources,
    localError: state.localError,
    cloudPlugins: state.cloudPlugins,
    cloudErrors: state.cloudErrors,
    fetchedSourceIds: state.fetchedSourceIds,
    sourceInventoryReady: state.sourceInventoryReady,
  });
}

export function writeDiscoverCatalogCache(
  patch: Partial<DiscoverCatalogCacheSnapshot>,
): void {
  discoverSnapshotStore.applyCachePatch(patch);
}

export function clearDiscoverCatalogCache(): void {
  discoverSnapshotStore.clear();
}
