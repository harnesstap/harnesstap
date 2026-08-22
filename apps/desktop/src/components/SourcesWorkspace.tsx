import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchLibraryResourceDetail,
  fetchLibraryResources,
  fetchMarketplaces,
  fetchMarketplacePlugins,
} from "../lib/agent-client";
import { unregisterCatalog } from "../lib/api/publish";
import { removeMarketplace } from "../lib/api/marketplace-remove";
import {
  fetchLibraryPluginDetail,
  fetchLibraryPluginHeads,
  patchLibraryPluginAttachments,
  type LibraryPluginHead,
} from "../lib/api/library-plugins";
import {
  disconnectCatalogOrgApi,
  fetchCatalogPluginPreview,
  fetchCatalogScope,
  fetchMarketplacePluginPreview,
  isCloudAuthError,
  isCloudAuthMessage,
  isNameCollisionError,
  pullCatalogPlugin,
  searchCatalogPlugins,
  type CatalogPluginSearchHit,
  type CatalogScope,
  type SourcePreviewResult,
} from "../lib/api/sources";
import { fetchPluginOriginCheck, type PluginOriginCheckRow } from "../lib/api/plugin-origin-update";
import {
  popSourcesPane,
  sourcesEscapeAction,
  sourcesPaneHasPrevious,
  sourcesSidebarChangeAction,
  type SourcesPane,
} from "../lib/sources-pane";
import {
  applyOriginOutdated,
  cloudHitIsInLibrary,
  cloudSelectorKey,
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
  type SourceRow,
} from "../lib/sources-sidebar";
import type { LibraryResource, PluginMarketplaceEntry } from "../lib/types";
import { ConnectCatalogPanel } from "./ConnectCatalogPanel";
import { MarketplaceEditPanel } from "./MarketplaceEditPanel";
import { PinToPluginPanel } from "./PinToPluginPanel";
import { SourceSidebar } from "./SourceSidebar";
import { SourcesListPane, type SourcesGroupError } from "./SourcesListPane";
import { SourcesPluginTree, type SourcesTreeFile } from "./SourcesPluginTree";
import { SourcesPreviewPane } from "./SourcesPreviewPane";
import type { SourcesRecordActionsProps } from "./SourcesRecordActions";

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
}: SourcesWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [pane, setPane] = useState<SourcesPane>({ mode: "list" });
  const [marketplaces, setMarketplaces] = useState<PluginMarketplaceEntry[]>([]);
  const [scope, setScope] = useState<CatalogScope | null>(null);
  const [checkedIds, setCheckedIds] = useState<string[]>(["local"]);
  const [checksTouched, setChecksTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [marketplaceMode, setMarketplaceMode] = useState<"add" | "edit">("add");
  const [editingMarketplace, setEditingMarketplace] =
    useState<PluginMarketplaceEntry | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinMode, setPinMode] = useState<"pin" | "attach">("pin");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionAuthRequired, setActionAuthRequired] = useState(false);
  const [pullCollision, setPullCollision] = useState(false);
  const [pullAsName, setPullAsName] = useState("");
  const [installByHit, setInstallByHit] = useState<
    Record<string, SourcesInstallState>
  >({});
  const [sidebarConfirmOpen, setSidebarConfirmOpen] = useState(false);
  const [localHeads, setLocalHeads] = useState<LibraryPluginHead[]>([]);
  const [localResources, setLocalResources] = useState<LibraryResource[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [marketplaceHits, setMarketplaceHits] = useState<
    Record<
      string,
      { plugins: MarketplaceSourceInput["plugins"]; error: string | null }
    >
  >({});
  const [cloudPlugins, setCloudPlugins] = useState<CatalogPluginSearchHit[]>([]);
  const [cloudErrors, setCloudErrors] = useState<
    Array<{ sourceLabel: string; message: string }>
  >([]);
  const [cloudRequestError, setCloudRequestError] = useState<string | null>(null);
  const [cloudAuthRequired, setCloudAuthRequired] = useState(false);
  const [pulledCloudKeys, setPulledCloudKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [originCheckRows, setOriginCheckRows] = useState<
    PluginOriginCheckRow[]
  >([]);
  const [librarySearching, setLibrarySearching] = useState(false);
  const [cloudSearching, setCloudSearching] = useState(false);
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

  useEffect(() => {
    if (homeResetNonceSeen.current === homeResetNonce) {
      return;
    }
    homeResetNonceSeen.current = homeResetNonce;
    setQuery("");
    setChecksTouched(false);
    setCheckedIds(defaultCheckedSourceIds(rows));
    setPane({ mode: "list" });
  }, [homeResetNonce, rows]);

  const refresh = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!baseUrl) {
      setMarketplaces([]);
      setScope(null);
      return;
    }
    let cancelled = false;
    void Promise.all([
      fetchMarketplaces(baseUrl, token),
      fetchCatalogScope(baseUrl, token),
    ])
      .then(([marketplaceResult, nextScope]) => {
        if (cancelled) {
          return;
        }
        setMarketplaces(marketplaceResult.marketplaces);
        setScope(nextScope);
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

  useEffect(() => {
    if (!baseUrl) {
      setLocalHeads([]);
      setLocalResources([]);
      setLocalError(null);
      setMarketplaceHits({});
      setCloudPlugins([]);
      setCloudErrors([]);
      setCloudRequestError(null);
      setCloudAuthRequired(false);
      setLibrarySearching(false);
      setCloudSearching(false);
      return;
    }

    let cancelled = false;
    const localChecked = checkedRows.some((row) => row.kind === "local");
    const marketplaceRows = checkedRows.filter(
      (row) => row.kind === "marketplace",
    );
    setLibrarySearching(true);
    const pending: Promise<void>[] = [
      Promise.all([
        fetchLibraryPluginHeads(baseUrl, token),
        fetchLibraryResources(baseUrl, token),
      ])
        .then(([heads, resources]) => {
          if (cancelled) {
            return;
          }
          setLocalHeads(heads);
          setLocalResources(resources);
          setLocalError(null);
        })
        .catch((loadError: unknown) => {
          if (cancelled) {
            return;
          }
          if (localChecked) {
            setLocalHeads([]);
            setLocalResources([]);
            setLocalError(errorMessage(loadError, "Could not load library."));
          } else {
            setLocalError(null);
          }
        }),
    ];

    setMarketplaceHits((current) => {
      const next: typeof current = {};
      for (const row of marketplaceRows) {
        next[row.id] = current[row.id] ?? { plugins: [], error: null };
      }
      return next;
    });

    for (const row of marketplaceRows) {
      pending.push(
        fetchMarketplacePlugins(baseUrl, token, row.label)
          .then((result) => {
            if (cancelled) {
              return;
            }
            setMarketplaceHits((current) => ({
              ...current,
              [row.id]: {
                plugins: result.plugins.map((plugin) => ({
                  name: plugin.name,
                  ...(plugin.version ? { version: plugin.version } : {}),
                  ...(plugin.description
                    ? { description: plugin.description }
                    : {}),
                })),
                error: null,
              },
            }));
          })
          .catch((loadError: unknown) => {
            if (cancelled) {
              return;
            }
            setMarketplaceHits((current) => ({
              ...current,
              [row.id]: {
                plugins: [],
                error: errorMessage(loadError, `Could not load ${row.label}.`),
              },
            }));
          }),
      );
    }

    void Promise.allSettled(pending).then(() => {
      if (!cancelled) {
        setLibrarySearching(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, checkedRows, reloadKey]);

  useEffect(() => {
    if (!baseUrl) {
      return;
    }
    const cloudRows = checkedRows.filter(
      (row) => row.kind === "cloud-org" || row.kind === "cloud-catalog",
    );
    if (cloudRows.length === 0) {
      setCloudPlugins([]);
      setCloudErrors([]);
      setCloudRequestError(null);
      setCloudAuthRequired(false);
      setCloudSearching(false);
      return;
    }

    if (cloudAuthenticated) {
      setCloudAuthRequired(false);
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setCloudSearching(true);
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
          setCloudPlugins([]);
          setCloudErrors([]);
          setCloudRequestError(
            errorMessage(loadError, "Could not search catalog plugins."),
          );
          setCloudAuthRequired(isCloudAuthError(loadError));
        })
        .finally(() => {
          if (!cancelled) {
            setCloudSearching(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [baseUrl, token, query, checkedRows, cloudAuthenticated]);

  useEffect(() => {
    if (!baseUrl) {
      setOriginCheckRows([]);
      return;
    }
    let cancelled = false;
    void fetchPluginOriginCheck(baseUrl, token, { refresh: true })
      .then((report) => {
        if (!cancelled) {
          setOriginCheckRows(report.results);
        }
      })
      .catch((checkError: unknown) => {
        if (!cancelled) {
          setOriginCheckRows([]);
          setActionError(
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
    const marketplaceInputs: MarketplaceSourceInput[] = checkedRows
      .filter((row) => row.kind === "marketplace")
      .map((row) => ({
        sourceId: row.id,
        sourceLabel: row.label,
        marketplaceName: row.label,
        plugins: marketplaceHits[row.id]?.plugins ?? [],
      }));
    const cloudInputs = checkedRows
      .filter((row) => row.kind === "cloud-org" || row.kind === "cloud-catalog")
      .map((row) => ({
        sourceId: row.id,
        sourceLabel: row.label,
        plugins: pluginsForCloudRow(row, cloudPlugins),
      }));

    return mergeSourcesHits({
      query,
      sourceOrder,
      ...(localChecked
        ? {
            local: {
              sourceId: "local",
              sourceLabel: "Local",
              heads: localHeads,
              resources: localResources,
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
          if (!identity) {
            return hit;
          }
          return {
            ...hit,
            presence: cloudHitIsInLibrary(identity, localHeads, [
              ...pulledCloudKeys,
            ]),
          };
        }),
        originCheckRows,
      ),
    }));
  }, [
    checkedRows,
    cloudPlugins,
    localHeads,
    localResources,
    marketplaceHits,
    originCheckRows,
    pulledCloudKeys,
    query,
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

  useEffect(() => {
    const overlayOpen = marketplaceOpen || catalogOpen || pinOpen;
    if (!sourcesPaneHasPrevious(pane) && !overlayOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (pinOpen) {
        event.preventDefault();
        setPinOpen(false);
        return;
      }
      if (marketplaceOpen) {
        event.preventDefault();
        setMarketplaceOpen(false);
        setEditingMarketplace(null);
        return;
      }
      if (catalogOpen) {
        event.preventDefault();
        setCatalogOpen(false);
        return;
      }
      if (!sourcesPaneHasPrevious(pane)) {
        return;
      }
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
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [catalogOpen, marketplaceOpen, pane, pinOpen, sidebarConfirmOpen]);

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
        current.includes(id)
          ? current.filter((item) => item !== id)
          : [...current, id],
      );
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

  const runPull = async (hit: SourcesHit): Promise<string | null> => {
    if (!baseUrl) {
      return null;
    }
    const selector = cloudSelectorForHit(hit);
    if (!selector) {
      setActionError("Missing catalog selector.");
      return null;
    }
    const as = pullCollision ? pullAsName.trim() : "";
    const result = await pullCatalogPlugin(baseUrl, token, {
      selector,
      ...(as ? { as } : {}),
    });
    setInstallByHit((current) => ({
      ...current,
      [hit.id]: { ...current[hit.id], pulledName: result.plugin.name },
    }));
    const identity = hit.identity.cloud;
    if (identity) {
      setPulledCloudKeys((current) => {
        const next = new Set(current);
        next.add(cloudSelectorKey(identity));
        return next;
      });
    }
    setPullCollision(false);
    setPullAsName("");
    return result.plugin.name;
  };

  const onPull = async (hit: SourcesHit) => {
    if (!baseUrl || busy) {
      return;
    }
    setBusy(true);
    setActionError(null);
    setActionAuthRequired(false);
    try {
      const name = await runPull(hit);
      if (name) {
        onSuccess?.(`Pulled ${name}.`);
        refresh();
      }
    } catch (pullError: unknown) {
      applyInstallError(pullError, "Could not pull plugin.");
    } finally {
      setBusy(false);
    }
  };

  const onPinConfirm = async (targetName: string) => {
    const hit = resolvedHitRef.current;
    if (!baseUrl || !hit || busy) {
      return;
    }
    setBusy(true);
    setActionError(null);
    setActionAuthRequired(false);
    try {
      if (
        hit.identity.cloud
        && hit.presence === "remote_only"
        && !installByHit[hit.id]?.pulledName
      ) {
        const pulled = await runPull(hit);
        if (!pulled) {
          setPinOpen(false);
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
      onSuccess?.(
        hit.kind === "standalone"
          ? `Attached to ${targetName}.`
          : `Pinned to ${targetName}.`,
      );
      refresh();
    } catch (pinError: unknown) {
      setPinOpen(false);
      applyInstallError(pinError, "Could not update plugin.");
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
      onPull: () => void onPull(hit),
      onPinToPlugin: () => {
        resetActionState();
        setPinMode("pin");
        setPinOpen(true);
      },
      onAttachToPlugin: () => {
        resetActionState();
        setPinMode("attach");
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

  function renderMainPane() {
    switch (pane.mode) {
      case "list":
        return (
          <SourcesListPane
            groups={groups}
            groupErrors={groupErrors}
            loading={librarySearching || cloudSearching}
            query={query}
            disabled={controlsDisabled}
            onOpenHit={openHit}
            onSignIn={onSignIn}
          />
        );
      case "plugin-tree":
        if (!resolvedHit) {
          return (
            <div className="empty-state">
              <p className="muted">Plugin is no longer in the search results.</p>
            </div>
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
            onBack={() => setPane(popSourcesPane(pane))}
            onOpenFile={(filePath) => {
              setPane({ mode: "preview", hitId: resolvedHit.id, filePath });
            }}
            onSignIn={onSignIn}
          />
        );
      case "preview":
        if (!resolvedHit) {
          return (
            <div className="empty-state">
              <p className="muted">Item is no longer in the search results.</p>
            </div>
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
            onBack={() => setPane(popSourcesPane(pane))}
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
      className="resources-panel sources-workspace"
      aria-label="Sources"
      data-testid="sources-workspace"
      data-sources-pane={pane.mode}
      data-origin-update-label="Update available"
    >
      <div className="resources-panel-header">
        <div className="resources-panel-header-row">
          <div className="resources-panel-title">
            <span>Sources</span>
            <span className="muted resources-panel-scope">
              Search local, marketplaces, and HarnessTap Cloud.
            </span>
          </div>
          <div className="resources-panel-header-actions">
            <button
              type="button"
              className="btn primary"
              aria-label="Add marketplace"
              title="Add marketplace"
              disabled={controlsDisabled}
              onClick={() => {
                setMarketplaceMode("add");
                setEditingMarketplace(null);
                setMarketplaceOpen(true);
              }}
            >
              Add marketplace
            </button>
            <button
              type="button"
              className="btn"
              aria-label="Connect catalog"
              title="Connect catalog"
              disabled={controlsDisabled}
              onClick={() => setCatalogOpen(true)}
            >
              Connect catalog
            </button>
          </div>
        </div>
      </div>

      <div className="resources-panel-layout">
        <SourceSidebar
          query={query}
          onQueryChange={(next) => {
            applyListQueryOrChecks(() => setQuery(next));
          }}
          rows={rows}
          checkedIds={checkedIds}
          onToggle={onToggle}
          disabled={controlsDisabled}
          busy={busy}
          error={error}
          onConfirmOpenChange={setSidebarConfirmOpen}
          onEditMarketplace={(name) => {
            const entry = marketplaces.find((item) => item.name === name) ?? null;
            if (!entry) {
              return;
            }
            setMarketplaceMode("edit");
            setEditingMarketplace(entry);
            setMarketplaceOpen(true);
          }}
          onRemoveMarketplace={(name) => void onRemoveMarketplace(name)}
          onDisconnectOrg={(org) => void onDisconnectOrg(org)}
          onUnregisterCatalog={(selector) => void onUnregisterCatalog(selector)}
        />
        <div className="resources-panel-body">{renderMainPane()}</div>
      </div>

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
        excludeName={resolvedHit?.identity.localPluginName}
        baseUrl={baseUrl}
        token={token}
        disabled={controlsDisabled}
        confirming={busy}
        onClose={() => setPinOpen(false)}
        onConfirm={(pluginName) => void onPinConfirm(pluginName)}
        onCreated={(plugin) => {
          setLocalHeads((current) => {
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
