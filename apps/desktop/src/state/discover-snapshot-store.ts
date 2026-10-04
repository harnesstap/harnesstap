import { fetchMarketplacePlugins, fetchMarketplaces } from "../lib/agent-client";
import type { LibraryPluginHead } from "../lib/api/library-plugins";
import { fetchCatalogScope, type CatalogPluginSearchHit, type CatalogScope } from "../lib/api/sources";
import type { LibraryListEntry } from "../lib/library-list";
import {
  DISCOVER_MARKETPLACE_HIT_SCHEMA,
  marketplaceIdsNeedingCatalogFetch,
  type MarketplaceSourceInput,
} from "../lib/sources-search";
import type {
  LibraryResource,
  MarketplaceListResult,
  MarketplacePluginsResult,
  PluginMarketplaceEntry,
} from "../lib/types";
import type { AgentClient } from "./agent-session";
import {
  librarySnapshotStore,
  type LibrarySnapshotStore,
} from "./library-snapshot-store";

export interface DiscoverMarketplaceHitCache {
  plugins: MarketplaceSourceInput["plugins"];
  error: string | null;
  schema?: number;
  fetchedAt?: string;
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

export interface DiscoverSnapshotStoreState extends DiscoverCatalogCacheSnapshot {
  generation: number;
  hydrated: boolean;
  error: string | null;
}

export const initialDiscoverSnapshotState: DiscoverSnapshotStoreState = {
  generation: 0,
  hydrated: false,
  error: null,
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

export interface DiscoverSnapshotFetchers {
  fetchMarketplaces: (
    baseUrl: string,
    token: string | null,
  ) => Promise<MarketplaceListResult>;
  fetchCatalogScope: (
    baseUrl: string,
    token: string | null,
  ) => Promise<CatalogScope>;
  fetchMarketplacePlugins: (
    baseUrl: string,
    token: string | null,
    name: string,
  ) => Promise<MarketplacePluginsResult>;
}

const defaultFetchers: DiscoverSnapshotFetchers = {
  fetchMarketplaces,
  fetchCatalogScope,
  fetchMarketplacePlugins,
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function marketplaceNameFromSourceId(sourceId: string): string | null {
  if (!sourceId.startsWith("mkt:")) {
    return null;
  }
  const name = sourceId.slice("mkt:".length);
  return name.length > 0 ? name : null;
}

function toPluginHead(entry: LibraryListEntry): LibraryPluginHead {
  return {
    id: entry.id,
    name: entry.name,
    version: entry.version ?? "",
    tags: entry.tags ?? [],
    description: entry.description,
    origin: entry.pluginOrigin ?? "authored",
    dirty: entry.dirty ?? false,
    org_slug: "",
    catalog_slug: "",
  };
}

function toLibraryResource(entry: LibraryListEntry): LibraryResource {
  return {
    id: entry.id,
    name: entry.name,
    type: entry.type,
    namespace: entry.namespace,
    description: entry.description,
    ...(entry.hook ? { hook: entry.hook } : {}),
    ...(entry.source !== undefined ? { source: entry.source } : {}),
    ...(entry.filesystem_path !== undefined ? { filesystem_path: entry.filesystem_path } : {}),
    ...(entry.updated_at !== undefined ? { updated_at: entry.updated_at } : {}),
    ...(entry.origin_kind !== undefined ? { origin_kind: entry.origin_kind } : {}),
    ...(entry.origin_ref !== undefined ? { origin_ref: entry.origin_ref } : {}),
    ...(entry.tags !== undefined ? { tags: entry.tags } : {}),
  };
}

function mapCatalogPlugin(
  plugin: MarketplacePluginsResult["plugins"][number],
): MarketplaceSourceInput["plugins"][number] {
  return {
    name: plugin.name,
    ...(plugin.version ? { version: plugin.version } : {}),
    ...(plugin.description ? { description: plugin.description } : {}),
    ...(plugin.tags && plugin.tags.length > 0 ? { tags: plugin.tags } : {}),
    ...(plugin.contents && plugin.contents.length > 0
      ? { contents: plugin.contents }
      : {}),
  };
}

function cacheSnapshotFromState(
  state: DiscoverSnapshotStoreState,
): DiscoverCatalogCacheSnapshot {
  return {
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
  };
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

export interface DiscoverSnapshotStore {
  getState: () => DiscoverSnapshotStoreState;
  subscribe: (listener: () => void) => () => void;
  setClient: (client: AgentClient | null) => void;
  clear: () => void;
  applyCachePatch: (patch: Partial<DiscoverCatalogCacheSnapshot>) => void;
  loadSources: () => Promise<void>;
  warm: () => Promise<void>;
  syncLocalFromLibraryPeek: () => void;
  loadFillIn: (marketplaceIds: string[]) => Promise<void>;
  invalidate: () => Promise<void>;
}

export function createDiscoverSnapshotStore(
  fetchers: DiscoverSnapshotFetchers = defaultFetchers,
  libraryStore: Pick<LibrarySnapshotStore, "getState"> | undefined = librarySnapshotStore,
): DiscoverSnapshotStore {
  const library = libraryStore ?? librarySnapshotStore;
  let state = initialDiscoverSnapshotState;
  let client: AgentClient | null = null;
  const listeners = new Set<() => void>();
  let sourcesGeneration = 0;
  let fillGeneration = 0;
  const filledMarketplaceIds: string[] = [];

  const setState = (patch: Partial<DiscoverSnapshotStoreState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) {
      listener();
    }
  };

  const isCurrent = (
    kind: "sources" | "fill",
    requestGeneration: number,
    snapshotGeneration: number,
  ): boolean => {
    if (state.generation !== snapshotGeneration) {
      return false;
    }
    switch (kind) {
      case "sources":
        return sourcesGeneration === requestGeneration;
      case "fill":
        return fillGeneration === requestGeneration;
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  };

  const rememberFilledIds = (marketplaceIds: string[]) => {
    for (const id of marketplaceIds) {
      if (marketplaceNameFromSourceId(id) && !filledMarketplaceIds.includes(id)) {
        filledMarketplaceIds.push(id);
      }
    }
  };

  const syncLocalFromLibraryPeek = (): void => {
    const libraryState = library.getState();
    const rows = libraryState.full ?? libraryState.peek ?? [];
    const localHeads: LibraryPluginHead[] = [];
    const localResources: LibraryResource[] = [];
    for (const row of rows) {
      switch (row.listKind) {
        case "plugin-package":
          localHeads.push(toPluginHead(row));
          break;
        case "resource":
          localResources.push(toLibraryResource(row));
          break;
        default: {
          const _exhaustive: never = row.listKind;
          return _exhaustive;
        }
      }
    }
    setState({
      localHeads,
      localResources,
      localError: null,
      hydrated: true,
    });
  };

  const loadSources = async (): Promise<void> => {
    if (!client) {
      return;
    }
    const requestGeneration = ++sourcesGeneration;
    const snapshotGeneration = state.generation;
    const bound = client;
    syncLocalFromLibraryPeek();
    try {
      const [marketplaceResult, scope] = await Promise.all([
        fetchers.fetchMarketplaces(bound.baseUrl, bound.token),
        fetchers.fetchCatalogScope(bound.baseUrl, bound.token),
      ]);
      if (!isCurrent("sources", requestGeneration, snapshotGeneration)) {
        return;
      }
      const fetchedSourceIds = state.fetchedSourceIds.includes("local")
        ? state.fetchedSourceIds
        : [...state.fetchedSourceIds, "local"];
      setState({
        marketplaces: marketplaceResult.marketplaces,
        scope,
        sourceInventoryReady: true,
        fetchedSourceIds,
        error: null,
        hydrated: true,
      });
    } catch (error) {
      if (!isCurrent("sources", requestGeneration, snapshotGeneration) || isAbortError(error)) {
        return;
      }
      setState({
        sourceInventoryReady: true,
        error: errorMessage(error, "Could not load sources."),
        hydrated: true,
      });
    }
  };

  const loadFillIn = async (marketplaceIds: string[]): Promise<void> => {
    if (!client) {
      return;
    }
    const ids = marketplaceIds.filter((id) => marketplaceNameFromSourceId(id) !== null);
    if (ids.length === 0) {
      return;
    }
    rememberFilledIds(ids);
    const requestGeneration = ++fillGeneration;
    const snapshotGeneration = state.generation;
    const bound = client;
    await Promise.all(
      ids.map(async (sourceId) => {
        const name = marketplaceNameFromSourceId(sourceId);
        if (!name) {
          return;
        }
        try {
          const result = await fetchers.fetchMarketplacePlugins(
            bound.baseUrl,
            bound.token,
            name,
          );
          if (!isCurrent("fill", requestGeneration, snapshotGeneration)) {
            return;
          }
          const fetchedSourceIds = state.fetchedSourceIds.includes(sourceId)
            ? state.fetchedSourceIds
            : [...state.fetchedSourceIds, sourceId];
          setState({
            marketplaceHits: {
              ...state.marketplaceHits,
              [sourceId]: {
                plugins: result.plugins.map(mapCatalogPlugin),
                error: null,
                schema: DISCOVER_MARKETPLACE_HIT_SCHEMA,
                fetchedAt: new Date().toISOString(),
              },
            },
            fetchedSourceIds,
            hydrated: true,
          });
        } catch (error) {
          if (!isCurrent("fill", requestGeneration, snapshotGeneration) || isAbortError(error)) {
            return;
          }
          setState({
            marketplaceHits: {
              ...state.marketplaceHits,
              [sourceId]: {
                plugins: state.marketplaceHits[sourceId]?.plugins ?? [],
                error: errorMessage(error, `Could not load ${name}.`),
              },
            },
            fetchedSourceIds: state.fetchedSourceIds.includes(sourceId)
              ? state.fetchedSourceIds
              : [...state.fetchedSourceIds, sourceId],
            hydrated: true,
          });
        }
      }),
    );
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setClient: (next) => {
      client = next;
    },
    clear: () => {
      sourcesGeneration += 1;
      fillGeneration += 1;
      filledMarketplaceIds.length = 0;
      setState({
        ...initialDiscoverSnapshotState,
        generation: state.generation + 1,
      });
    },
    applyCachePatch: (patch) => {
      const base = cacheSnapshotFromState(state);
      setState({
        ...base,
        ...patch,
        marketplaceHits: persistableDiscoverMarketplaceHits(
          patch.marketplaceHits ? patch.marketplaceHits : base.marketplaceHits,
        ),
        fetchedSourceIds: patch.fetchedSourceIds
          ? [...patch.fetchedSourceIds]
          : base.fetchedSourceIds,
        hydrated: true,
      });
    },
    loadSources,
    async warm() {
      await loadSources();
      const marketplaceIds = marketplaceIdsNeedingCatalogFetch({
        marketplaceIds: state.marketplaces.map((entry) => `mkt:${entry.name}`),
        hits: state.marketplaceHits,
      });
      if (marketplaceIds.length === 0) {
        return;
      }
      await loadFillIn(marketplaceIds);
    },
    syncLocalFromLibraryPeek,
    loadFillIn,
    async invalidate() {
      const refillIds = [...filledMarketplaceIds];
      sourcesGeneration += 1;
      fillGeneration += 1;
      setState({ generation: state.generation + 1 });
      if (!client) {
        return;
      }
      await loadSources();
      if (refillIds.length > 0) {
        await loadFillIn(refillIds);
      }
    },
  };
}

export const discoverSnapshotStore: DiscoverSnapshotStore = createDiscoverSnapshotStore();
