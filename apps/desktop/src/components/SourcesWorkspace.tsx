import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  fetchLibraryResourceDetail,
  fetchMarketplaces,
} from "../lib/agent-client";
import { unregisterCatalog } from "../lib/api/publish";
import { removeMarketplace } from "../lib/api/marketplace-remove";
import {
  fetchDiscoverSearch,
  type DiscoverSearchGroup,
  type DiscoverSearchMarketplacePlugin,
} from "../lib/api/discover-search";
import {
  fetchLibraryPluginDetail,
  patchLibraryPluginAttachments,
  type LibraryPluginHead,
} from "../lib/api/library-plugins";
import {
  disconnectCatalogOrgApi,
  fetchCatalogPluginPreview,
  fetchMarketplacePluginPreview,
  isCloudAuthError,
  isCloudAuthMessage,
  isNameCollisionError,
  addMarketplacePluginToLibrary,
  pullCatalogPlugin,
  searchCatalogPlugins,
  type CatalogPluginSearchHit,
  type SourcePreviewResult,
} from "../lib/api/sources";
import { fetchPluginOriginCheck, type PluginOriginCheckRow } from "../lib/api/plugin-origin-update";
import { workspaceBackEnabled, WORKSPACE_BACK_LABEL } from "../lib/screen-history";
import { useRegisterCommands } from "../state/command-registry";
import { discoverSnapshotStore } from "../state/discover-snapshot-store";
import {
  popSourcesPane,
  sourcesEscapeAction,
  sourcesPaneHasPrevious,
  sourcesSidebarChangeAction,
  type SourcesPane,
} from "../lib/sources-pane";
import {
  readDiscoverCatalogCache,
  writeDiscoverCatalogCache,
} from "../lib/discover-catalog-cache";
import {
  applyOriginOutdated,
  cloudHitIsInLibrary,
  cloudSelectorKey,
  DISCOVER_MARKETPLACE_CACHE_MAX_AGE_MS,
  discoverListIsSearching,
  discoverMarketplaceRefreshCopy,
  discoverSourcesRefreshing,
  marketplaceHitKey,
  marketplaceIdsNeedingCatalogFetch,
  marketplaceRefreshMaxAgeMsFromMinutes,
  mergeSourcesHits,
  sourcesHitFetchKey,
  type CloudPluginInput,
  type MarketplaceSourceInput,
  type SourcesHit,
  type SourcesHitGroup,
} from "../lib/sources-search";
import {
  sourcesAttachmentAdd,
  sourcesHitActions,
  type SourcesInstallState,
} from "../lib/sources-record-actions";
import {
  buildSourceRows,
  defaultCheckedSourceIds,
  nextCheckedSourceIds,
  nextCheckedSourceIdsForChild,
  type SourceRow,
} from "../lib/sources-sidebar";
import type { PluginMarketplaceEntry } from "../lib/types";
import { Cloud, Store, ArrowLeft, List } from "lucide-react";
import { ConnectCatalogPanel } from "./ConnectCatalogPanel";
import { EmptyState } from "./EmptyState";
import { IconActionButton } from "./IconActionButton";
import { WorkspaceBackButton } from "./WorkspaceBackButton";
import { WorkspaceRefreshButton } from "./WorkspaceRefreshButton";
import { ManageMarketplacesModal } from "./ManageMarketplacesModal";
import { MarketplaceEditPanel } from "./MarketplaceEditPanel";
import { PinToPluginPanel } from "./PinToPluginPanel";
import { SourceSidebar } from "./SourceSidebar";
import { SourcesListPane, type SourcesGroupError } from "./SourcesListPane";
import { SourcesPluginTree, type SourcesTreeFile } from "./SourcesPluginTree";
import { SourcesPreviewPane } from "./SourcesPreviewPane";
import type { SourcesRecordActionsProps } from "./SourcesRecordActions";
import { Crossfade } from "./motion/Crossfade";
import { useEscapeWhenNoLayer } from "../state/overlay-stack";

const FALLBACK_DEFAULT_ORG = "harnesstap-cloud";
const SEARCH_DEBOUNCE_MS = 250;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isPreviewFileList(
  result: SourcePreviewResult,
): result is { files: Array<{ path: string; kind: "file" }> } {
  return "files" in result;
}

function previewContent(result: SourcePreviewResult): string | null {
  return "content" in result ? result.content : null;
}

function marketplacePluginsFromSearch(
  plugins: DiscoverSearchMarketplacePlugin[] | undefined,
): MarketplaceSourceInput["plugins"] {
  if (!plugins) {
    return [];
  }
  return plugins.map((plugin) => ({
    name: plugin.name,
    ...(plugin.version ? { version: plugin.version } : {}),
    ...(plugin.description ? { description: plugin.description } : {}),
    ...(plugin.tags && plugin.tags.length > 0 ? { tags: plugin.tags } : {}),
    ...(plugin.contents && Array.isArray(plugin.contents) && plugin.contents.length > 0
      ? {
          contents: plugin.contents as MarketplaceSourceInput["plugins"][number]["contents"],
        }
      : {}),
  }));
}

function toCloudPluginInput(plugin: CatalogPluginSearchHit): CloudPluginInput {
  return {
    selector: plugin.selector,
    name: plugin.name,
    orgSlug: plugin.orgSlug,
    catalogSlug: plugin.catalogSlug,
    ...(plugin.version ? { version: plugin.version } : {}),
    ...(plugin.description ? { description: plugin.description } : {}),
    ...(plugin.tags && plugin.tags.length > 0 ? { tags: plugin.tags } : {}),
  };
}

function cloudSelectorForHit(hit: SourcesHit): string | null {
  const identity = hit.identity.cloud;
  if (!identity) {
    return null;
  }
  const base = `${identity.org}/${identity.catalog}/${identity.name}`;
  return hit.version ? `${base}@${hit.version}` : base;
}

function pluginsForCloudRow(
  row: SourceRow,
  plugins: CatalogPluginSearchHit[],
): CloudPluginInput[] {
  switch (row.kind) {
    case "cloud-org":
      return plugins
        .filter((plugin) => plugin.orgSlug === row.label)
        .map(toCloudPluginInput);
    case "cloud-catalog": {
      const slash = row.label.indexOf("/");
      const org = slash === -1 ? row.label : row.label.slice(0, slash);
      const catalog = slash === -1 ? "" : row.label.slice(slash + 1);
      return plugins
        .filter(
          (plugin) => plugin.orgSlug === org && plugin.catalogSlug === catalog,
        )
        .map(toCloudPluginInput);
    }
    case "local":
    case "marketplace":
      return [];
    default: {
      const neverKind: never = row.kind;
      return neverKind;
    }
  }
}

function sourceIdForCloudLabel(
  sourceLabel: string,
  rows: SourceRow[],
): string | undefined {
  return rows.find(
    (row) =>
      (row.kind === "cloud-org" || row.kind === "cloud-catalog")
      && row.label === sourceLabel,
  )?.id;
}

export interface SourcesWorkspaceProps {
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  homeResetNonce?: number;
  onSuccess?: (message: string) => void;
  onSignIn?: () => void;
  onOpenInLibrary?: (selector: string) => void;
  cloudAuthenticated?: boolean;
  canWorkspaceBack?: boolean;
  onWorkspaceBack?: () => void;
  disconnected?: boolean;
}

export function SourcesWorkspace({
  baseUrl,
  token,
  disabled = false,
  homeResetNonce = 0,
  onSuccess,
  onSignIn,
  onOpenInLibrary,
  cloudAuthenticated = false,
  canWorkspaceBack = false,
  onWorkspaceBack,
  disconnected = false,
}: SourcesWorkspaceProps) {
  const snapshot = useSyncExternalStore(
    discoverSnapshotStore.subscribe,
    discoverSnapshotStore.getState,
    discoverSnapshotStore.getState,
  );
  const [query, setQuery] = useState("");
  const [searchGroups, setSearchGroups] = useState<DiscoverSearchGroup[] | null>(
    null,
  );
  const searchGenerationRef = useRef(0);
  const [pane, setPane] = useState<SourcesPane>({ mode: "list" });
  const marketplaces = snapshot.marketplaces;
  const [marketplaceRefreshMaxAgeMs, setMarketplaceRefreshMaxAgeMs] = useState(
    DISCOVER_MARKETPLACE_CACHE_MAX_AGE_MS,
  );
  const scope = snapshot.scope;
  const sourceInventoryReady = snapshot.sourceInventoryReady;
  const [checkedIds, setCheckedIds] = useState<string[]>(["local"]);
  const [checksTouched, setChecksTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const bypassCatalogCacheRef = useRef(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [manageMarketplacesOpen, setManageMarketplacesOpen] = useState(false);
  const [marketplaceMode, setMarketplaceMode] = useState<"add" | "edit">("add");
  const [editingMarketplace, setEditingMarketplace] =
    useState<PluginMarketplaceEntry | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const discoverCommandsLocked = disabled || !baseUrl;
  useRegisterCommands(
    "discover",
    useMemo(
      () => [
        {
          id: "discover-add-marketplace",
          section: "actions" as const,
          label: "Add marketplace",
          disabled: discoverCommandsLocked,
          run: () => {
            setMarketplaceMode("add");
            setEditingMarketplace(null);
            setMarketplaceOpen(true);
          },
        },
        {
          id: "discover-connect-catalog",
          section: "actions" as const,
          label: "Connect catalog",
          disabled: discoverCommandsLocked,
          run: () => setCatalogOpen(true),
        },
      ],
      [discoverCommandsLocked],
    ),
  );
  const [pinOpen, setPinOpen] = useState(false);
  const [pinMode, setPinMode] = useState<"pin" | "attach">("pin");
  const [pinHit, setPinHit] = useState<SourcesHit | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [originCheckError, setOriginCheckError] = useState<string | null>(null);
  const [actionAuthRequired, setActionAuthRequired] = useState(false);
  const [pullCollision, setPullCollision] = useState(false);
  const [pullAsName, setPullAsName] = useState("");
  const [installByHit, setInstallByHit] = useState<
    Record<string, SourcesInstallState>
  >({});
  const [sidebarConfirmOpen, setSidebarConfirmOpen] = useState(false);
  const [createdHeads, setCreatedHeads] = useState<LibraryPluginHead[]>([]);
  const localHeads = useMemo(() => {
    if (createdHeads.length === 0) {
      return snapshot.localHeads;
    }
    const ids = new Set(snapshot.localHeads.map((head) => head.id));
    return [
      ...snapshot.localHeads,
      ...createdHeads.filter((head) => !ids.has(head.id)),
    ];
  }, [createdHeads, snapshot.localHeads]);
  const localResources = snapshot.localResources;
  const localError = snapshot.localError;
  const marketplaceHits = snapshot.marketplaceHits;
  const [cloudPlugins, setCloudPlugins] = useState<CatalogPluginSearchHit[]>(
    () => readDiscoverCatalogCache()?.cloudPlugins ?? [],
  );
  const [cloudErrors, setCloudErrors] = useState<
    Array<{ sourceLabel: string; message: string }>
  >(() => readDiscoverCatalogCache()?.cloudErrors ?? []);
  const [cloudRequestError, setCloudRequestError] = useState<string | null>(null);
  const [cloudAuthRequired, setCloudAuthRequired] = useState(false);
  const [pulledCloudKeys, setPulledCloudKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [addedMarketplaceKeys, setAddedMarketplaceKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [originCheckRows, setOriginCheckRows] = useState<
    PluginOriginCheckRow[]
  >([]);
  const [fetchedSourceIds, setFetchedSourceIds] = useState<Set<string>>(
    () => new Set(readDiscoverCatalogCache()?.fetchedSourceIds ?? []),
  );
  const [inflightSourceIds, setInflightSourceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const marketplaceHitsRef = useRef(marketplaceHits);
  marketplaceHitsRef.current = marketplaceHits;
  const [activeHit, setActiveHit] = useState<SourcesHit | null>(null);
  const [treeFiles, setTreeFiles] = useState<SourcesTreeFile[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeAuthRequired, setTreeAuthRequired] = useState(false);
  const [previewContentState, setPreviewContentState] = useState<string | null>(
    null,
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewAuthRequired, setPreviewAuthRequired] = useState(false);
  const homeResetNonceSeen = useRef(homeResetNonce);
  const paneRef = useRef(pane);
  paneRef.current = pane;

  const rows = useMemo(
    () =>
      buildSourceRows({
        marketplaces,
        defaultOrg: scope?.defaultOrg ?? FALLBACK_DEFAULT_ORG,
        connectedOrgs: scope?.connectedOrgs ?? [],
        registered: scope?.registered ?? [],
      }),
    [marketplaces, scope],
  );

  useEffect(() => {
    if (!checksTouched) {
      setCheckedIds(defaultCheckedSourceIds(rows));
    }
  }, [rows, checksTouched]);

  function resetSourcesFilters(): void {
    setQuery("");
    setChecksTouched(false);
    setCheckedIds(defaultCheckedSourceIds(rows));
  }

  useEffect(() => {
    if (homeResetNonceSeen.current === homeResetNonce) {
      return;
    }
    homeResetNonceSeen.current = homeResetNonce;
    resetSourcesFilters();
    setPane({ mode: "list" });
  }, [homeResetNonce, rows]);

  const refresh = useCallback(() => {
    setReloadKey((value) => value + 1);
    void discoverSnapshotStore.loadSources();
  }, []);

  const refreshSources = useCallback(async () => {
    bypassCatalogCacheRef.current = true;
    setReloadKey((value) => value + 1);
    await discoverSnapshotStore.invalidate();
  }, []);

  useEffect(() => {
    if (!baseUrl) {
      return;
    }
    let cancelled = false;
    void discoverSnapshotStore.loadSources();
    void fetchMarketplaces(baseUrl, token)
      .then((marketplaceResult) => {
        if (cancelled) {
          return;
        }
        setMarketplaceRefreshMaxAgeMs(
          marketplaceRefreshMaxAgeMsFromMinutes(
            marketplaceResult.marketplaceRefreshMaxAgeMinutes,
          ),
        );
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(errorMessage(loadError, "Could not load sources."));
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, reloadKey]);

  const checkedRows = useMemo(
    () => rows.filter((row) => checkedIds.includes(row.id)),
    [rows, checkedIds],
  );
  const searchActive = query.trim().length > 0;

  useEffect(() => {
    if (!baseUrl) {
      return;
    }
    discoverSnapshotStore.syncLocalFromLibraryPeek();
  }, [baseUrl]);

  useEffect(() => {
    if (!baseUrl) {
      setInflightSourceIds(new Set());
      return;
    }

    let cancelled = false;
    const marketplaceRows = checkedRows.filter(
      (row) => row.kind === "marketplace",
    );
    setFetchedSourceIds((current) => {
      if (current.has("local")) {
        return current;
      }
      const next = new Set(current);
      next.add("local");
      return next;
    });

    if (!sourceInventoryReady || searchActive) {
      return;
    }

    const fetchMarketplaceIds = marketplaceIdsNeedingCatalogFetch({
      marketplaceIds: marketplaceRows.map((row) => row.id),
      hits: marketplaceHitsRef.current,
      bypassCache: bypassCatalogCacheRef.current,
      maxAgeMs: marketplaceRefreshMaxAgeMs,
    });
    bypassCatalogCacheRef.current = false;
    const reuseMarketplaceIds = marketplaceRows
      .map((row) => row.id)
      .filter((id) => !fetchMarketplaceIds.includes(id));
    const markFetched = (ids: string[]) => {
      if (cancelled) {
        return;
      }
      setFetchedSourceIds((current) => {
        const next = new Set(current);
        for (const id of ids) {
          next.add(id);
        }
        return next;
      });
      setInflightSourceIds((current) => {
        const next = new Set(current);
        for (const id of ids) {
          next.delete(id);
        }
        return next;
      });
    };

    if (reuseMarketplaceIds.length > 0) {
      markFetched(reuseMarketplaceIds);
    }

    if (fetchMarketplaceIds.length === 0) {
      return;
    }

    setInflightSourceIds((current) => {
      const next = new Set(current);
      for (const id of fetchMarketplaceIds) {
        next.add(id);
      }
      return next;
    });
    void discoverSnapshotStore.loadFillIn(fetchMarketplaceIds).finally(() => {
      markFetched(fetchMarketplaceIds);
    });

    return () => {
      cancelled = true;
    };
  }, [
    baseUrl,
    checkedRows,
    reloadKey,
    searchActive,
    sourceInventoryReady,
    marketplaceRefreshMaxAgeMs,
  ]);

  useEffect(() => {
    if (!baseUrl) {
      return;
    }
    const cloudRows = checkedRows.filter(
      (row) => row.kind === "cloud-org" || row.kind === "cloud-catalog",
    );
    if (cloudRows.length === 0) {
      if (sourceInventoryReady) {
        setCloudPlugins([]);
        setCloudErrors([]);
        setCloudRequestError(null);
        setCloudAuthRequired(false);
      }
      setInflightSourceIds((current) => {
        const next = new Set(current);
        for (const id of [...current]) {
          if (id.startsWith("org:") || id.startsWith("cat:")) {
            next.delete(id);
          }
        }
        return next;
      });
      return;
    }

    if (cloudAuthenticated) {
      setCloudAuthRequired(false);
    }

    let cancelled = false;
    const cloudIds = cloudRows.map((row) => row.id);
    setInflightSourceIds((current) => {
      const next = new Set(current);
      for (const id of cloudIds) {
        next.add(id);
      }
      return next;
    });
    const timer = window.setTimeout(() => {
      const orgs = cloudRows
        .filter((row) => row.kind === "cloud-org")
        .map((row) => row.label);
      const registered = cloudRows
        .filter((row) => row.kind === "cloud-catalog")
        .map((row) => row.label);
      void searchCatalogPlugins(baseUrl, token, {
        q: query,
        orgs,
        registered,
      })
        .then((result) => {
          if (cancelled) {
            return;
          }
          setCloudPlugins(result.plugins);
          setCloudErrors(result.errors);
          setCloudRequestError(null);
          setCloudAuthRequired(false);
        })
        .catch((loadError: unknown) => {
          if (cancelled) {
            return;
          }
          setCloudRequestError(
            errorMessage(loadError, "Could not search catalog plugins."),
          );
          setCloudAuthRequired(isCloudAuthError(loadError));
        })
        .finally(() => {
          if (cancelled) {
            return;
          }
          setFetchedSourceIds((current) => {
            const next = new Set(current);
            for (const id of cloudIds) {
              next.add(id);
            }
            return next;
          });
          setInflightSourceIds((current) => {
            const next = new Set(current);
            for (const id of cloudIds) {
              next.delete(id);
            }
            return next;
          });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setInflightSourceIds((current) => {
        const next = new Set(current);
        for (const id of cloudIds) {
          next.delete(id);
        }
        return next;
      });
    };
  }, [baseUrl, token, query, checkedRows, cloudAuthenticated, sourceInventoryReady]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!baseUrl || trimmed.length === 0) {
      setSearchGroups(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    const requestGeneration = ++searchGenerationRef.current;
    const searchIds = checkedRows
      .filter((row) => row.kind === "local" || row.kind === "marketplace")
      .map((row) => row.id);
    setInflightSourceIds((current) => {
      const next = new Set(current);
      for (const id of searchIds) {
        next.add(id);
      }
      return next;
    });
    const timer = window.setTimeout(() => {
      void fetchDiscoverSearch(baseUrl, token, {
        q: trimmed,
        sources: checkedIds,
        signal: controller.signal,
      })
        .then((result) => {
          if (cancelled || requestGeneration !== searchGenerationRef.current) {
            return;
          }
          setSearchGroups(result.groups);
        })
        .catch((loadError: unknown) => {
          if (
            cancelled
            || requestGeneration !== searchGenerationRef.current
            || (loadError instanceof Error && loadError.name === "AbortError")
          ) {
            return;
          }
          setError(errorMessage(loadError, "Could not search Discover sources."));
        })
        .finally(() => {
          if (cancelled || requestGeneration !== searchGenerationRef.current) {
            return;
          }
          setInflightSourceIds((current) => {
            const next = new Set(current);
            for (const id of searchIds) {
              next.delete(id);
            }
            return next;
          });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
      setInflightSourceIds((current) => {
        const next = new Set(current);
        for (const id of searchIds) {
          next.delete(id);
        }
        return next;
      });
    };
  }, [baseUrl, token, query, checkedIds, checkedRows]);

  useEffect(() => {
    if (!baseUrl) {
      setOriginCheckRows([]);
      return;
    }
    let cancelled = false;
    void fetchPluginOriginCheck(baseUrl, token)
      .then((report) => {
        if (!cancelled) {
          setOriginCheckRows(report.results);
          setOriginCheckError(null);
        }
      })
      .catch((checkError: unknown) => {
        if (!cancelled) {
          setOriginCheckRows([]);
          setOriginCheckError(
            errorMessage(checkError, "Could not check plugins against origin"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, reloadKey]);

  const sourceOrder = useMemo(
    () => checkedRows.map((row) => row.id),
    [checkedRows],
  );

  const groups: SourcesHitGroup[] = useMemo(() => {
    const localChecked = checkedRows.some((row) => row.id === "local");
    const useSearch = searchActive && searchGroups !== null;
    const searchById = useSearch
      ? new Map(searchGroups.map((group) => [group.sourceId, group]))
      : null;
    const marketplaceInputs: MarketplaceSourceInput[] = checkedRows
      .filter((row) => row.kind === "marketplace")
      .map((row) => ({
        sourceId: row.id,
        sourceLabel: row.label,
        marketplaceName: row.label,
        plugins: useSearch
          ? marketplacePluginsFromSearch(searchById?.get(row.id)?.plugins)
          : (marketplaceHits[row.id]?.plugins ?? []),
      }));
    const cloudInputs = checkedRows
      .filter((row) => row.kind === "cloud-org" || row.kind === "cloud-catalog")
      .map((row) => ({
        sourceId: row.id,
        sourceLabel: row.label,
        plugins: pluginsForCloudRow(row, cloudPlugins),
      }));

    const merged = mergeSourcesHits({
      query,
      sourceOrder,
      ...(localChecked
        ? {
            local: {
              sourceId: "local",
              sourceLabel: searchById?.get("local")?.sourceLabel ?? "Local",
              heads: useSearch
                ? (searchById?.get("local")?.heads ?? [])
                : localHeads,
              resources: useSearch
                ? (searchById?.get("local")?.resources ?? [])
                : localResources,
            },
          }
        : {}),
      marketplaces: marketplaceInputs,
      cloud: cloudInputs,
      libraryHeads: localHeads,
      libraryResources: localResources,
    }).map((group) => ({
      ...group,
      hits: applyOriginOutdated(
        group.hits.map((hit) => {
          const identity = hit.identity.cloud;
          if (identity) {
            return {
              ...hit,
              presence: cloudHitIsInLibrary(identity, localHeads, [
                ...pulledCloudKeys,
              ]),
            };
          }
          const marketplace = hit.identity.marketplace;
          if (
            marketplace
            && addedMarketplaceKeys.has(marketplaceHitKey(marketplace))
          ) {
            return { ...hit, presence: "in_library" as const };
          }
          return hit;
        }),
        originCheckRows,
      ),
    }));
    return merged;
  }, [
    checkedRows,
    cloudPlugins,
    localHeads,
    localResources,
    marketplaceHits,
    originCheckRows,
    pulledCloudKeys,
    addedMarketplaceKeys,
    query,
    searchActive,
    searchGroups,
    sourceOrder,
  ]);

  const groupErrors = useMemo(() => {
    const next: Record<string, SourcesGroupError> = {};
    if (localError && checkedRows.some((row) => row.id === "local")) {
      next.local = { message: localError, authRequired: false };
    }
    for (const row of checkedRows) {
      if (row.kind !== "marketplace") {
        continue;
      }
      const marketplaceError = marketplaceHits[row.id]?.error;
      if (marketplaceError) {
        next[row.id] = { message: marketplaceError, authRequired: false };
      }
    }
    const cloudRows = checkedRows.filter(
      (row) => row.kind === "cloud-org" || row.kind === "cloud-catalog",
    );
    if (cloudAuthRequired) {
      for (const row of cloudRows) {
        next[row.id] = {
          message: cloudRequestError ?? "Cloud sign-in required",
          authRequired: true,
        };
      }
    } else if (cloudRequestError) {
      for (const row of cloudRows) {
        next[row.id] = { message: cloudRequestError, authRequired: false };
      }
    } else {
      for (const cloudError of cloudErrors) {
        const sourceId = sourceIdForCloudLabel(cloudError.sourceLabel, rows);
        if (!sourceId) {
          continue;
        }
        next[sourceId] = {
          message: cloudError.message,
          authRequired: isCloudAuthMessage(cloudError.message),
        };
      }
    }
    return next;
  }, [
    checkedRows,
    cloudAuthRequired,
    cloudErrors,
    cloudRequestError,
    localError,
    marketplaceHits,
    rows,
  ]);

  const hitById = useMemo(() => {
    const map = new Map<string, SourcesHit>();
    for (const group of groups) {
      for (const hit of group.hits) {
        map.set(hit.id, hit);
      }
    }
    return map;
  }, [groups]);

  const paneHitId = pane.mode === "list" ? null : pane.hitId;
  const paneFilePath = pane.mode === "preview" ? pane.filePath : undefined;
  const listedHit = paneHitId ? hitById.get(paneHitId) : undefined;
  const resolvedHit =
    pane.mode === "list"
      ? null
      : activeHit?.id === pane.hitId
        ? {
            ...activeHit,
            ...(listedHit
              ? {
                  presence: listedHit.presence,
                  originOutdated: listedHit.originOutdated,
                }
              : {}),
          }
        : (listedHit ?? null);
  const openFetchKey = resolvedHit ? sourcesHitFetchKey(resolvedHit) : "";
  const resolvedHitRef = useRef(resolvedHit);
  resolvedHitRef.current = resolvedHit;

  useEffect(() => {
    if (pane.mode !== "plugin-tree" || !paneHitId || !baseUrl || !openFetchKey) {
      return;
    }
    const hit = resolvedHitRef.current;
    if (!hit) {
      return;
    }
    let cancelled = false;
    setTreeLoading(true);
    setTreeError(null);
    setTreeAuthRequired(false);
    setTreeFiles([]);
    void loadPluginTree(baseUrl, token, hit)
      .then((files) => {
        if (!cancelled) {
          setTreeFiles(files);
        }
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }
        setTreeAuthRequired(isCloudAuthError(loadError));
        setTreeError(errorMessage(loadError, "Could not load plugin files."));
      })
      .finally(() => {
        if (!cancelled) {
          setTreeLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, pane.mode, paneHitId, openFetchKey, token]);

  useEffect(() => {
    if (pane.mode !== "preview" || !paneHitId || !baseUrl || !openFetchKey) {
      return;
    }
    const hit = resolvedHitRef.current;
    if (!hit) {
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewAuthRequired(false);
    setPreviewContentState(null);
    void loadPreview(baseUrl, token, hit, paneFilePath)
      .then((content) => {
        if (!cancelled) {
          setPreviewContentState(content);
        }
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }
        setPreviewAuthRequired(isCloudAuthError(loadError));
        setPreviewError(errorMessage(loadError, "Could not load preview."));
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, pane.mode, paneHitId, paneFilePath, openFetchKey, token]);

  // Pin / marketplace / catalog panels register their own overlay layers and
  // close themselves on Esc; this only handles Back when nothing is open.
  useEscapeWhenNoLayer(
    (event: KeyboardEvent) => {
      const action = sourcesEscapeAction({
        confirmOpen: sidebarConfirmOpen,
      });
      switch (action) {
        case "dismiss-confirm":
          return;
        case "leave-pane":
          event.preventDefault();
          setPane(popSourcesPane(paneRef.current));
          return;
        default: {
          const neverAction: never = action;
          return neverAction;
        }
      }
    },
    sourcesPaneHasPrevious(pane),
  );

  const applyListQueryOrChecks = (apply: () => void): void => {
    const current = paneRef.current;
    if (current.mode === "list") {
      apply();
      return;
    }
    const action = sourcesSidebarChangeAction({
      busy,
      confirmOpen: sidebarConfirmOpen || pinOpen,
    });
    switch (action) {
      case "block":
        return;
      case "leave-and-apply":
        setPane({ mode: "list" });
        apply();
        return;
      default: {
        const neverAction: never = action;
        return neverAction;
      }
    }
  };

  const onToggle = (id: string) => {
    applyListQueryOrChecks(() => {
      setChecksTouched(true);
      setCheckedIds((current) =>
        nextCheckedSourceIdsForChild(current, rows, id),
      );
    });
  };

  const onToggleAll = () => {
    applyListQueryOrChecks(() => {
      setChecksTouched(true);
      setCheckedIds((current) => nextCheckedSourceIds(current, rows));
    });
  };

  const onRemoveMarketplace = async (name: string) => {
    if (!baseUrl || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await removeMarketplace(baseUrl, token, name);
      onSuccess?.(`Removed marketplace ${name}.`);
      refresh();
    } catch (removeError: unknown) {
      setError(errorMessage(removeError, "Could not remove marketplace."));
    } finally {
      setBusy(false);
    }
  };

  const onDisconnectOrg = async (org: string) => {
    if (!baseUrl || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await disconnectCatalogOrgApi(baseUrl, token, org);
      onSuccess?.(`Disconnected org ${org}.`);
      refresh();
    } catch (disconnectError: unknown) {
      setError(errorMessage(disconnectError, "Could not disconnect org."));
    } finally {
      setBusy(false);
    }
  };

  const onUnregisterCatalog = async (selector: string) => {
    if (!baseUrl || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await unregisterCatalog(baseUrl, token, selector);
      onSuccess?.(`Unregistered ${selector}.`);
      refresh();
    } catch (unregisterError: unknown) {
      setError(errorMessage(unregisterError, "Could not unregister catalog."));
    } finally {
      setBusy(false);
    }
  };

  const openHit = (hit: SourcesHit) => {
    setActiveHit(hit);
    resetActionState();
    switch (hit.kind) {
      case "plugin":
        setPane({ mode: "plugin-tree", hitId: hit.id });
        return;
      case "standalone":
        setPane({ mode: "preview", hitId: hit.id });
        return;
      default: {
        const neverKind: never = hit.kind;
        return neverKind;
      }
    }
  };

  const resetActionState = () => {
    setActionError(null);
    setActionAuthRequired(false);
    setPullCollision(false);
    setPullAsName("");
  };

  const applyInstallError = (installError: unknown, fallback: string): void => {
    if (isCloudAuthError(installError)) {
      setActionAuthRequired(true);
      setActionError(null);
      return;
    }
    if (isNameCollisionError(installError)) {
      setPullCollision(true);
      setActionError(
        errorMessage(
          installError,
          "A local plugin with that name already exists.",
        ),
      );
      return;
    }
    setActionError(errorMessage(installError, fallback));
  };

  const runAddToLibrary = async (hit: SourcesHit): Promise<string | null> => {
    if (!baseUrl) {
      return null;
    }
    const as = pullCollision ? pullAsName.trim() : "";
    if (hit.identity.cloud) {
      const cloud = hit.identity.cloud;
      const selector = cloudSelectorForHit(hit);
      if (!selector) {
        setActionError("Missing catalog selector.");
        return null;
      }
      const result = await pullCatalogPlugin(baseUrl, token, {
        selector,
        ...(as ? { as } : {}),
      });
      setInstallByHit((current) => ({
        ...current,
        [hit.id]: { ...current[hit.id], pulledName: result.plugin.name },
      }));
      setPulledCloudKeys((current) => {
        const next = new Set(current);
        next.add(cloudSelectorKey(cloud));
        return next;
      });
      setPullCollision(false);
      setPullAsName("");
      return result.plugin.name;
    }
    if (hit.identity.marketplace) {
      const marketplace = hit.identity.marketplace;
      const result = await addMarketplacePluginToLibrary(baseUrl, token, {
        marketplace: marketplace.marketplace,
        plugin: marketplace.plugin,
        ...(as ? { as } : {}),
      });
      setInstallByHit((current) => ({
        ...current,
        [hit.id]: { ...current[hit.id], addedName: result.plugin.name },
      }));
      setAddedMarketplaceKeys((current) => {
        const next = new Set(current);
        next.add(marketplaceHitKey(marketplace));
        return next;
      });
      setPullCollision(false);
      setPullAsName("");
      return result.plugin.name;
    }
    setActionError("This item is already in your Library.");
    return null;
  };

  const onAddToLibrary = async (hit: SourcesHit) => {
    if (!baseUrl || busy) {
      return;
    }
    setBusy(true);
    setActionError(null);
    setActionAuthRequired(false);
    try {
      const name = await runAddToLibrary(hit);
      if (name) {
        onSuccess?.(`Added ${name} to Library.`);
        refresh();
      }
    } catch (addError: unknown) {
      applyInstallError(addError, "Could not add to Library.");
    } finally {
      setBusy(false);
    }
  };

  const onPinConfirm = async (targetName: string) => {
    const hit = pinHit ?? resolvedHitRef.current;
    if (!baseUrl || !hit || busy) {
      return;
    }
    setBusy(true);
    setPinError(null);
    setActionError(null);
    setActionAuthRequired(false);
    try {
      if (
        hit.identity.cloud
        && hit.presence === "remote_only"
        && !installByHit[hit.id]?.pulledName
      ) {
        const pulled = await runAddToLibrary(hit);
        if (!pulled) {
          setPinError("Could not add to Library.");
          return;
        }
      }
      await patchLibraryPluginAttachments(baseUrl, token, targetName, {
        add: [sourcesAttachmentAdd(hit)],
      });
      setInstallByHit((current) => ({
        ...current,
        [hit.id]: { ...current[hit.id], pinnedTargetName: targetName },
      }));
      setPinOpen(false);
      setPinHit(null);
      onSuccess?.(
        hit.kind === "standalone"
          ? `Attached to ${targetName}.`
          : `Pinned to ${targetName}.`,
      );
      refresh();
    } catch (confirmError: unknown) {
      const message = errorMessage(confirmError, "Could not update plugin.");
      setPinError(message);
      applyInstallError(confirmError, "Could not update plugin.");
    } finally {
      setBusy(false);
    }
  };

  const recordActionsProps = (hit: SourcesHit): SourcesRecordActionsProps => {
    const actions = sourcesHitActions(hit, installByHit[hit.id]);
    return {
      actions,
      busy,
      disabled: controlsDisabled,
      error: actionError,
      authRequired: actionAuthRequired,
      collision: pullCollision,
      asName: pullAsName,
      onAsNameChange: setPullAsName,
      onSignIn,
      onAddToLibrary: () => void onAddToLibrary(hit),
      onPinToPlugin: () => {
        resetActionState();
        setPinError(null);
        setPinHit(hit);
        setPinMode(hit.kind === "standalone" ? "attach" : "pin");
        setPinOpen(true);
      },
      onOpenInLibrary: () => {
        const selector = actions.openInLibrarySelector;
        if (!selector) {
          return;
        }
        onOpenInLibrary?.(selector);
      },
    };
  };

  const controlsDisabled = disabled || !baseUrl;
  const hasLocalPrevious = sourcesPaneHasPrevious(pane);
  const backDisabled =
    controlsDisabled
    || !workspaceBackEnabled({
      hasLocalPrevious,
      hasWorkspacePrevious: canWorkspaceBack,
    })
    || (hasLocalPrevious && (busy || sidebarConfirmOpen));

  const visibleHitCount = groups.reduce(
    (sum, group) => sum + group.hits.length,
    0,
  );
  const fetchedIdsForList = useMemo(() => {
    const next = new Set(fetchedSourceIds);
    for (const id of snapshot.fetchedSourceIds) {
      next.add(id);
    }
    return next;
  }, [fetchedSourceIds, snapshot.fetchedSourceIds]);
  const listSearching = discoverListIsSearching({
    checkedIds: checkedRows.map((row) => row.id),
    fetchedIds: fetchedIdsForList,
    inflightIds: inflightSourceIds,
    visibleCount: visibleHitCount,
  });
  const sidebarRefreshing = discoverSourcesRefreshing({
    fetchedIds: fetchedIdsForList,
    inflightIds: inflightSourceIds,
  });
  const marketplaceIds = checkedRows
    .filter((row) => row.kind === "marketplace")
    .map((row) => row.id);
  const marketplaceRefreshCopy = discoverMarketplaceRefreshCopy({
    marketplaceIds,
    inflightIds: inflightSourceIds,
  });

  useEffect(() => {
    if (!baseUrl) {
      return;
    }
    writeDiscoverCatalogCache({
      cloudPlugins,
      cloudErrors,
      fetchedSourceIds: [...fetchedSourceIds],
    });
  }, [baseUrl, cloudPlugins, cloudErrors, fetchedSourceIds]);

  function handlePanelBack(): void {
    const current = paneRef.current;
    if (sourcesPaneHasPrevious(current)) {
      if (busy || sidebarConfirmOpen) {
        return;
      }
      setPane(popSourcesPane(current));
      return;
    }
    onWorkspaceBack?.();
  }

  function renderMainPane() {
    switch (pane.mode) {
      case "list":
        return (
          <SourcesListPane
            groups={groups}
            groupErrors={groupErrors}
            loading={listSearching}
            query={query}
            disabled={controlsDisabled}
            onOpenHit={openHit}
            onSignIn={onSignIn}
            onClearSearch={() => {
              applyListQueryOrChecks(() => setQuery(""));
            }}
            onClearQuery={() => applyListQueryOrChecks(() => setQuery(""))}
            recordActions={recordActionsProps}
          />
        );
      case "plugin-tree":
        if (!resolvedHit) {
          return (
            <EmptyState
              title="Plugin is no longer in the search results"
              body="Go back to the Discover list."
              action={{
                label: WORKSPACE_BACK_LABEL,
                onClick: () => setPane(popSourcesPane(pane)),
                icon: <ArrowLeft size={16} aria-hidden />,
              }}
            />
          );
        }
        return (
          <SourcesPluginTree
            hit={resolvedHit}
            files={treeFiles}
            loading={treeLoading}
            error={treeError}
            authRequired={treeAuthRequired}
            disabled={controlsDisabled}
            recordActions={recordActionsProps(resolvedHit)}
            onOpenFile={(filePath) => {
              setPane({ mode: "preview", hitId: resolvedHit.id, filePath });
            }}
            onSignIn={onSignIn}
          />
        );
      case "preview":
        if (!resolvedHit) {
          return (
            <EmptyState
              title="Item is no longer in the search results"
              body="Go back to the Discover list."
              action={{
                label: WORKSPACE_BACK_LABEL,
                onClick: () => setPane(popSourcesPane(pane)),
                icon: <ArrowLeft size={16} aria-hidden />,
              }}
            />
          );
        }
        return (
          <SourcesPreviewPane
            hit={resolvedHit}
            filePath={pane.filePath}
            content={previewContentState}
            loading={previewLoading}
            error={previewError}
            authRequired={previewAuthRequired}
            disabled={controlsDisabled}
            recordActions={recordActionsProps(resolvedHit)}
            onSignIn={onSignIn}
          />
        );
      default: {
        const neverPane: never = pane;
        return neverPane;
      }
    }
  }

  return (
    <main
      className={["resources-panel", "sources-workspace", disconnected ? "is-disconnected" : ""]
        .filter(Boolean)
        .join(" ")}
      aria-label="Discover"
      aria-busy={marketplaceRefreshCopy || sidebarRefreshing ? true : undefined}
      data-testid="sources-workspace"
      data-sources-pane={pane.mode}
      data-origin-update-label="Update available"
    >
      <div className="resources-panel-header">
        <div className="resources-panel-header-row">
          <div className="resources-panel-title-cluster">
            <WorkspaceBackButton
              hidden={!hasLocalPrevious}
              disabled={backDisabled}
              onClick={handlePanelBack}
            />
            <div className="resources-panel-title">
              <span>
                Discover
                {marketplaceRefreshCopy ? (
                  <span
                    className="muted resources-panel-scope"
                    aria-live="polite"
                  >
                    {marketplaceRefreshCopy}
                  </span>
                ) : null}
              </span>
              <span className="muted resources-panel-scope">
                Find and add from local, marketplaces, and HarnessTap Cloud.
              </span>
            </div>
          </div>
          <div className="resources-panel-header-actions">
            <WorkspaceRefreshButton
              testId="discover-refresh"
              label="Refresh sources"
              iconSize={20}
              disabled={controlsDisabled}
              onRefresh={refreshSources}
            />
            <IconActionButton
              primary
              label="Add marketplace"
              title="Add marketplace"
              disabled={controlsDisabled}
              onClick={() => {
                setMarketplaceMode("add");
                setEditingMarketplace(null);
                setMarketplaceOpen(true);
              }}
              icon={<Store size={20} aria-hidden />}
            />
            <IconActionButton
              label="Manage marketplaces"
              title="Manage marketplaces"
              disabled={controlsDisabled}
              onClick={() => setManageMarketplacesOpen(true)}
              icon={<List size={20} aria-hidden />}
            />
            <IconActionButton
              label="Connect catalog"
              title="Connect catalog"
              disabled={controlsDisabled}
              onClick={() => setCatalogOpen(true)}
              icon={<Cloud size={20} aria-hidden />}
            />
          </div>
        </div>
      </div>

      <div className="resources-panel-layout">
        <SourceSidebar
          query={query}
          onQueryChange={(next) => {
            applyListQueryOrChecks(() => setQuery(next));
          }}
          onClear={() => {
            applyListQueryOrChecks(resetSourcesFilters);
          }}
          rows={rows}
          checkedIds={checkedIds}
          onToggle={onToggle}
          onToggleAll={onToggleAll}
          disabled={controlsDisabled}
          busy={busy}
          error={error ?? snapshot.error}
          originCheckError={originCheckError}
          onRetryOriginCheck={refresh}
          refreshing={sidebarRefreshing}
          onConfirmOpenChange={setSidebarConfirmOpen}
          onDisconnectOrg={(org) => void onDisconnectOrg(org)}
          onUnregisterCatalog={(selector) => void onUnregisterCatalog(selector)}
        />
        <div className="resources-panel-body">
          <Crossfade activeKey={pane.mode} className="sources-pane-crossfade">
            {renderMainPane()}
          </Crossfade>
        </div>
      </div>

      <ManageMarketplacesModal
        open={manageMarketplacesOpen}
        marketplaces={marketplaces}
        baseUrl={baseUrl}
        token={token}
        busy={busy}
        disabled={controlsDisabled}
        onClose={() => setManageMarketplacesOpen(false)}
        onEdit={(entry) => {
          setManageMarketplacesOpen(false);
          setMarketplaceMode("edit");
          setEditingMarketplace(entry);
          setMarketplaceOpen(true);
        }}
        onRemove={(name) => void onRemoveMarketplace(name)}
      />
      <MarketplaceEditPanel
        open={marketplaceOpen}
        mode={marketplaceMode}
        entry={editingMarketplace}
        baseUrl={baseUrl}
        token={token}
        disabled={controlsDisabled}
        onClose={() => {
          setMarketplaceOpen(false);
          setEditingMarketplace(null);
        }}
        onSaved={(message) => {
          onSuccess?.(message);
          refresh();
        }}
        onListed={refresh}
      />
      <ConnectCatalogPanel
        open={catalogOpen}
        baseUrl={baseUrl}
        token={token}
        disabled={controlsDisabled}
        onClose={() => setCatalogOpen(false)}
        onSaved={(message) => {
          onSuccess?.(message);
          refresh();
        }}
      />
      <PinToPluginPanel
        open={pinOpen}
        mode={pinMode}
        heads={localHeads}
        excludeName={
          pinHit?.identity.localPluginName
          ?? resolvedHit?.identity.localPluginName
        }
        baseUrl={baseUrl}
        token={token}
        disabled={controlsDisabled}
        confirming={busy}
        error={pinError}
        onClose={() => {
          setPinOpen(false);
          setPinHit(null);
          setPinError(null);
        }}
        onConfirm={(pluginName) => void onPinConfirm(pluginName)}
        onCreated={(plugin) => {
          setCreatedHeads((current) => {
            if (current.some((head) => head.id === plugin.id)) {
              return current;
            }
            return [...current, plugin];
          });
        }}
      />
    </main>
  );
}

async function loadPluginTree(
  baseUrl: string,
  token: string | null,
  hit: SourcesHit,
): Promise<SourcesTreeFile[]> {
  if (hit.identity.marketplace) {
    const result = await fetchMarketplacePluginPreview(
      baseUrl,
      token,
      hit.identity.marketplace.marketplace,
      hit.identity.marketplace.plugin,
    );
    if (!isPreviewFileList(result)) {
      return [];
    }
    return result.files.map((file) => ({ path: file.path, label: file.path }));
  }
  if (hit.identity.cloud) {
    const selector = cloudSelectorForHit(hit);
    if (!selector) {
      return [];
    }
    const result = await fetchCatalogPluginPreview(baseUrl, token, selector);
    if (!isPreviewFileList(result)) {
      return [];
    }
    return result.files.map((file) => ({ path: file.path, label: file.path }));
  }
  if (hit.identity.localPluginName) {
    const detail = await fetchLibraryPluginDetail(
      baseUrl,
      token,
      hit.identity.localPluginName,
    );
    return detail.resources.map((resource) => ({
      path: resource.id,
      label: resource.source || `${resource.type}:${resource.name}`,
    }));
  }
  return [];
}

async function loadPreview(
  baseUrl: string,
  token: string | null,
  hit: SourcesHit,
  filePath?: string,
): Promise<string | null> {
  if (hit.identity.marketplace) {
    if (!filePath) {
      return hit.description ?? "";
    }
    const result = await fetchMarketplacePluginPreview(
      baseUrl,
      token,
      hit.identity.marketplace.marketplace,
      hit.identity.marketplace.plugin,
      filePath,
    );
    return previewContent(result);
  }
  if (hit.identity.cloud) {
    const selector = cloudSelectorForHit(hit);
    if (!selector) {
      return null;
    }
    const result = await fetchCatalogPluginPreview(
      baseUrl,
      token,
      selector,
      filePath,
    );
    return previewContent(result);
  }
  if (hit.identity.localSelector) {
    const detail = await fetchLibraryResourceDetail(
      baseUrl,
      token,
      hit.identity.localSelector,
    );
    return detail.content;
  }
  if (hit.identity.localPluginName && filePath) {
    const detail = await fetchLibraryResourceDetail(baseUrl, token, filePath);
    return detail.content;
  }
  return hit.description ?? "";
}
