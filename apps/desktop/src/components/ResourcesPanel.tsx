import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, FolderDown, FolderInput, FilterX, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { IconActionButton } from "./IconActionButton";
import { ChromeTooltip } from "./ChromeTooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { useRegisterCommands } from "../state/command-registry";
import { ImportLibraryDrawer } from "./parity/ImportLibraryDrawer";
import { loadRecentProjects } from "../lib/recent-projects";
import { noResultsTitle } from "../lib/empty-copy";
import { ConfirmDialog } from "./ConfirmDialog";
import { LibraryDetailChrome } from "./LibraryDetailChrome";
import { LibraryResourceList } from "./library/LibraryResourceList";
import { PluginPackageDetail } from "./PluginPackageDetail";
import { ResourceCreatePanel } from "./ResourceCreatePanel";
import { ResourceDetailBody } from "./ResourceDetailBody";
import { ResourceFilterSidebar } from "./ResourceFilterSidebar";
import { ResourceTrackedDirectoriesModal } from "./ResourceTrackedDirectoriesModal";
import { ResourceTypeModal } from "./ResourceTypeModal";
import { ResourceTypeTabs } from "./ResourceTypeTabs";
import { WorkspaceBackButton } from "./WorkspaceBackButton";
import { WorkspaceRefreshButton } from "./WorkspaceRefreshButton";
import { Banner } from "./shell/Banner";
import { SkeletonRow } from "./shell/Skeleton";
import type { ApplyPluginResult } from "../lib/api/apply-plugin";
import {
  AgentApiError,
  fetchProfileDetail,
  fetchProfiles,
  rescanResourceTrackedDirectories,
} from "../lib/agent-client";
import { deleteLibraryPlugin } from "../lib/api/library-plugins";
import {
  fetchPluginOriginCheck,
  postPluginOriginUpdate,
} from "../lib/api/plugin-origin-update";
import { deleteLibraryResource } from "../lib/api/resource-mutate";
import {
  LIBRARY_BULK_DELETE_PREVIEW,
  libraryBulkDeleteLine,
  libraryBulkDeleteShowAllLabel,
  libraryBulkDeleteVisibleCount,
  pruneSelectedIds,
  selectAllCheckboxState,
  toggleSelectAllVisible,
} from "../lib/library-bulk-edit";
import { MUTATION_CHUNK_SIZE, settleInChunks } from "../lib/profile-inventory";
import {
  groupScopedLibraryRows,
  libraryFilterType,
  libraryRowSelector,
  libraryRowTreatAsScoped,
  type LibraryListEntry,
} from "../lib/library-list";
import {
  hasSeenTrackedDirsIntro,
  markTrackedDirsIntroSeen,
} from "../lib/library-tracked-dirs";
import {
  indexLibraryInUse,
  libraryInUseCompositionsFromDetails,
  libraryInUseProfilesFromSummaries,
  libraryInUseProjectBindingsFromListings,
  uniqueLibraryInUseProjectPaths,
  type LibraryInUseMembership,
} from "../lib/library-in-use";
import {
  escapeAction,
  libraryPaneHasPrevious,
  sidebarChangeAction,
  type LibraryPane,
} from "../lib/library-pane";
import {
  pluginPackageBackTarget,
  pluginPackageEscapeAction,
  type PluginDetailMode,
} from "../lib/plugin-history";
import type { CreateResourceType } from "../lib/resource-create-schema";
import {
  applyLibraryResourceFilters,
  defaultResourceFilterState,
  isResourceFilterStateActive,
  libraryTypeTabCounts,
  resetResourceFilterState,
  type ResourceFilterState,
} from "../lib/resource-filters";
import { duplicatePluginNames } from "../lib/resource-display";
import { resourceDisplayName } from "../lib/resource-search";
import {
  resolveResourceTypeTab,
  resourceTypeTabLabel,
} from "../lib/resource-type-tabs";
import { workspaceBackEnabled } from "../lib/screen-history";
import { useEscapeWhenNoLayer } from "../state/overlay-stack";
import {
  librarySnapshotStore,
  useLibrarySnapshotStore,
  visibleLibraryRows,
} from "../state/library-snapshot-store";
import type { LibraryResource, ProfileDetail, ProfileSummary } from "../lib/types";

const LIBRARY_SEARCH_DEBOUNCE_MS = 250;

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof AgentApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function overlayOriginOutdated(
  rows: readonly LibraryListEntry[],
  originOutdatedIds: ReadonlySet<string>,
): LibraryListEntry[] {
  return rows.map((row) => {
    if (row.listKind !== "plugin-package") {
      return row;
    }
    const originOutdated = originOutdatedIds.has(row.id);
    if (row.originOutdated === originOutdated) {
      return row;
    }
    return { ...row, originOutdated };
  });
}

export interface ResourcesPanelProps {
  baseUrl: string | null;
  token: string | null;
  /** Bump to force a library reload (e.g. after a tracked-directory rescan). */
  reloadKey?: number;
  /** Bump while mounted to return to the unfiltered list (header re-click). */
  homeResetNonce?: number;
  disabled?: boolean;
  projectPath?: string | null;
  selectedProfile?: string | null;
  /** Profile targeted by the create-form "add and apply" checkbox; hides it when null. */
  attachProfileName?: string | null;
  onAddToProfile?: (resource: { type: string; name: string }) => Promise<void>;
  onImported?: (message: string) => void;
  onSuccess?: (message: string) => void;
  onApplyResult?: (result: ApplyPluginResult) => void;
  focusPluginName?: string | null;
  onFocusPluginConsumed?: () => void;
  focusResourceSelector?: string | null;
  onFocusResourceConsumed?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onProfilesChanged?: () => void;
  canWorkspaceBack?: boolean;
  onWorkspaceBack?: () => void;
  autoOpenTrackedDirectories?: boolean;
  disconnected?: boolean;
}

export function ResourcesPanel({
  baseUrl,
  token,
  reloadKey = 0,
  homeResetNonce = 0,
  disabled = false,
  projectPath,
  selectedProfile,
  attachProfileName,
  onAddToProfile,
  onImported,
  onSuccess,
  onApplyResult,
  focusPluginName,
  onFocusPluginConsumed,
  focusResourceSelector,
  onFocusResourceConsumed,
  onBusyChange,
  onProfilesChanged,
  canWorkspaceBack = false,
  onWorkspaceBack,
  autoOpenTrackedDirectories = false,
  disconnected = false,
}: ResourcesPanelProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissedStoreError, setDismissedStoreError] = useState<string | null>(
    null,
  );
  const [originOutdatedIds, setOriginOutdatedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [inUseIndex, setInUseIndex] = useState<Map<string, LibraryInUseMembership>>(
    () => new Map(),
  );
  const [originUpdateBusy, setOriginUpdateBusy] = useState(false);
  const [originUpdateConfirmOpen, setOriginUpdateConfirmOpen] = useState(false);
  const [filterState, setFilterState] = useState<ResourceFilterState>(
    defaultResourceFilterState,
  );
  const [trackedDirsOpen, setTrackedDirsOpen] = useState(false);
  const trackedDirsIntroAttempted = useRef(false);

  useEffect(() => {
    if (!autoOpenTrackedDirectories || trackedDirsIntroAttempted.current) {
      return;
    }
    trackedDirsIntroAttempted.current = true;
    if (hasSeenTrackedDirsIntro()) {
      return;
    }
    markTrackedDirsIntroSeen();
    setTrackedDirsOpen(true);
  }, [autoOpenTrackedDirectories]);
  const [fieldEditing, setFieldEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const detailTitleId = useId();
  const [resourcesReloadKey, setResourcesReloadKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [pane, setPane] = useState<LibraryPane>({ mode: "list" });
  const [pluginHistoryMode, setPluginHistoryMode] =
    useState<PluginDetailMode>("head");
  const [pluginFrozenVersion, setPluginFrozenVersion] = useState<string | null>(
    null,
  );
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createType, setCreateType] = useState<CreateResourceType | null>(null);
  const [libraryEditMode, setLibraryEditModeState] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [bulkDeleteRevealed, setBulkDeleteRevealed] = useState(
    LIBRARY_BULK_DELETE_PREVIEW,
  );
  const libraryCommandsLocked = disabled || !baseUrl;
  useRegisterCommands(
    "library",
    useMemo(
      () => [
        {
          id: "library-create",
          section: "actions" as const,
          label: "Create resource",
          disabled: libraryCommandsLocked,
          run: () => setCreateModalOpen(true),
        },
        {
          id: "library-import",
          section: "actions" as const,
          label: "Import",
          disabled: libraryCommandsLocked,
          run: () => setImportOpen(true),
        },
        {
          id: "library-tracked-dirs",
          section: "actions" as const,
          label: "Tracked directories",
          disabled: libraryCommandsLocked,
          run: () => setTrackedDirsOpen(true),
        },
      ],
      [libraryCommandsLocked],
    ),
  );
  const paneRef = useRef(pane);
  paneRef.current = pane;
  const resolvedProjectPath =
    (projectPath && projectPath.trim())
    || loadRecentProjects()[0]?.path
    || "";
  const filterRef = useRef<HTMLInputElement>(null);
  const seenRowIdsRef = useRef<Set<string>>(new Set());
  const cancelFieldEditRef = useRef<(() => void) | null>(null);
  const [lastSelector, setLastSelector] = useState<string | null>(null);
  const [enteringIds, setEnteringIds] = useState<Set<string>>(() => new Set());
  const {
    peek,
    full,
    searchRows,
    status,
    error,
    searchError,
    snapshotRows,
  } = useLibrarySnapshotStore((state) => ({
    peek: state.peek,
    full: state.full,
    searchRows: state.searchRows,
    status: state.status,
    error: state.error,
    searchError: state.searchError,
    snapshotRows: visibleLibraryRows(state),
  }));
  const refreshing = status === "refreshing";
  const showSkeleton = peek == null && full == null && !error;

  useEffect(() => {
    if (!baseUrl) {
      return;
    }
    void librarySnapshotStore.loadFull();
  }, [baseUrl, token, resourcesReloadKey, reloadKey]);

  useEffect(() => {
    if (!baseUrl) {
      setInUseIndex(new Map());
      return;
    }
    let cancelled = false;
    const projectPaths = uniqueLibraryInUseProjectPaths(
      resolvedProjectPath,
      loadRecentProjects().map((row) => row.path),
    );
    void (async () => {
      try {
        const homeSummaries = await fetchProfiles(baseUrl);
        const listings: Array<{ path: string; profiles: ProfileSummary[] }> = [];
        for (const path of projectPaths) {
          listings.push({
            path,
            profiles: await fetchProfiles(baseUrl, path),
          });
        }
        const profiles = libraryInUseProfilesFromSummaries([
          ...homeSummaries,
          ...listings.flatMap((listing) => listing.profiles),
        ]);
        const names = [...new Set(profiles.map((profile) => profile.name))];
        const details: Array<{ profileName: string; detail: ProfileDetail }> = [];
        const loaded = await Promise.all(
          names.map(async (name) => {
            try {
              const detail = await fetchProfileDetail(baseUrl, token, name);
              return { profileName: name, detail };
            } catch {
              return null;
            }
          }),
        );
        for (const row of loaded) {
          if (row) {
            details.push(row);
          }
        }
        if (cancelled) {
          return;
        }
        setInUseIndex(
          indexLibraryInUse({
            profiles,
            compositions: libraryInUseCompositionsFromDetails(details),
            projectBindings: libraryInUseProjectBindingsFromListings(listings),
          }),
        );
      } catch {
        if (!cancelled) {
          setInUseIndex(new Map());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, resolvedProjectPath, resourcesReloadKey, reloadKey]);

  useEffect(() => {
    if (!baseUrl) {
      setOriginOutdatedIds(new Set());
      return;
    }
    let cancelled = false;
    void fetchPluginOriginCheck(baseUrl, token)
      .then((report) => {
        if (cancelled) {
          return;
        }
        const ids = new Set(
          report.results
            .filter((row) => row.status === "outdated")
            .map((row) => row.plugin_id),
        );
        setOriginOutdatedIds(ids);
      })
      .catch((checkError: unknown) => {
        if (!cancelled) {
          setOriginOutdatedIds(new Set());
          setActionError(
            errorMessage(checkError, "Could not check plugins against origin"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, resourcesReloadKey, reloadKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => filterRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!focusPluginName) {
      return;
    }
    setLastSelector(focusPluginName);
    setPane({
      mode: "detail",
      target: { kind: "plugin-package", selector: focusPluginName },
    });
    setPluginHistoryMode("head");
    setPluginFrozenVersion(null);
    onFocusPluginConsumed?.();
  }, [focusPluginName, onFocusPluginConsumed]);

  useEffect(() => {
    if (!focusResourceSelector) {
      return;
    }
    setLastSelector(focusResourceSelector);
    setPane({
      mode: "detail",
      target: {
        kind: "resource",
        selector: focusResourceSelector,
        label: focusResourceSelector,
      },
    });
    onFocusResourceConsumed?.();
  }, [focusResourceSelector, onFocusResourceConsumed]);

  const searchQuery = filterState.search.trim();
  const snapshotEntries = useMemo(
    () => overlayOriginOutdated(snapshotRows, originOutdatedIds),
    [originOutdatedIds, snapshotRows],
  );
  const entries = useMemo(() => {
    if (searchQuery.length === 0 || searchRows === null) {
      return snapshotEntries;
    }
    return overlayOriginOutdated(searchRows, originOutdatedIds);
  }, [originOutdatedIds, searchQuery, searchRows, snapshotEntries]);
  const outdatedCount = useMemo(
    () => snapshotEntries.filter((entry) => entry.originOutdated).length,
    [snapshotEntries],
  );

  const pickerResources = useMemo<LibraryResource[]>(
    () => snapshotEntries.filter((entry) => entry.listKind !== "plugin-package"),
    [snapshotEntries],
  );

  const typeCounts = useMemo(
    () =>
      libraryTypeTabCounts(entries, {
        ...filterState,
        search: "",
        type: null,
      }),
    [entries, filterState],
  );
  const typeTab = resolveResourceTypeTab(filterState.type, typeCounts);

  useEffect(() => {
    if (!baseUrl) {
      return;
    }
    const q = filterState.search.trim();
    if (q.length === 0) {
      void librarySnapshotStore.search({ q: "", type: null });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void librarySnapshotStore.search({
        q,
        type: null,
        signal: controller.signal,
      });
    }, LIBRARY_SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [baseUrl, filterState.search]);

  const filteredEntries = useMemo(
    () =>
      applyLibraryResourceFilters(entries, {
        ...filterState,
        search: "",
        type: typeTab,
      }),
    [filterState, entries, typeTab],
  );

  const collidingPluginNames = useMemo(
    () => duplicatePluginNames(snapshotEntries),
    [snapshotEntries],
  );

  const listRows = useMemo(
    () =>
      groupScopedLibraryRows(
        [...filteredEntries].sort((left, right) =>
          resourceDisplayName(left, collidingPluginNames).localeCompare(
            resourceDisplayName(right, collidingPluginNames),
          ),
        ),
        (row) => resourceDisplayName(row, collidingPluginNames),
        { treatAsScoped: libraryRowTreatAsScoped },
      ),
    [collidingPluginNames, filteredEntries],
  );

  const visibleRowIds = useMemo(
    () => listRows.map((row) => row.id),
    [listRows],
  );
  const selectedEntries = useMemo(() => {
    if (selectedIds.size === 0) {
      return [];
    }
    const fromList = listRows.filter((row) => selectedIds.has(row.id));
    const listed = new Set(fromList.map((row) => row.id));
    const rest = snapshotEntries.filter(
      (entry) => selectedIds.has(entry.id) && !listed.has(entry.id),
    );
    return [...fromList, ...rest];
  }, [listRows, selectedIds, snapshotEntries]);
  const selectAllState = selectAllCheckboxState(visibleRowIds, selectedIds);

  useEffect(() => {
    const seen = seenRowIdsRef.current;
    const nextEntering = new Set<string>();
    for (const row of listRows) {
      if (seen.size > 0 && !seen.has(row.id)) {
        nextEntering.add(row.id);
      }
      seen.add(row.id);
    }
    setEnteringIds(nextEntering);
  }, [listRows]);

  useEffect(() => {
    const known = new Set(snapshotEntries.map((entry) => entry.id));
    setSelectedIds((current) => {
      if (current.size === 0) {
        return current;
      }
      const next = pruneSelectedIds(current, known);
      return next.size === current.size ? current : next;
    });
  }, [snapshotEntries]);

  const libraryEmpty = snapshotEntries.length === 0;
  const storeErrorBanner =
    error && dismissedStoreError !== error ? error : null;
  const paneConfirmOpen = confirmOpen || originUpdateConfirmOpen || bulkDeleteOpen;

  function setLibraryEditMode(next: boolean): void {
    setLibraryEditModeState(next);
    if (!next) {
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      setBulkDeleteRevealed(LIBRARY_BULK_DELETE_PREVIEW);
    }
  }

  function leaveToList(): void {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setPane({ mode: "list" });
    setPluginHistoryMode("head");
    setPluginFrozenVersion(null);
    setFieldEditing(false);
    setConfirmOpen(false);
    setDetailBusy(false);
  }

  function handlePanelBack(): void {
    const current = paneRef.current;
    switch (current.mode) {
      case "detail": {
        if (current.target.kind === "plugin-package") {
          const target = pluginPackageBackTarget(pluginHistoryMode);
          switch (target) {
            case "history":
              setPluginHistoryMode("history");
              setPluginFrozenVersion(null);
              return;
            case "head":
              setPluginHistoryMode("head");
              setPluginFrozenVersion(null);
              return;
            case "list":
              leaveToList();
              return;
            default: {
              const neverTarget: never = target;
              return neverTarget;
            }
          }
        }
        leaveToList();
        return;
      }
      case "list":
        onWorkspaceBack?.();
        return;
      default: {
        const neverPane: never = current;
        return neverPane;
      }
    }
  }

  function applyFilterChange(next: ResourceFilterState): void {
    const current = paneRef.current;
    if (current.mode === "list") {
      setFilterState(next);
      return;
    }
    const action = sidebarChangeAction({
      busy: detailBusy,
      confirmOpen: paneConfirmOpen,
    });
    switch (action) {
      case "block":
        return;
      case "leave-and-apply":
        leaveToList();
        setFilterState(next);
        return;
      default: {
        const _exhaustive: never = action;
        return _exhaustive;
      }
    }
  }

  const applyFilterChangeRef = useRef(applyFilterChange);
  applyFilterChangeRef.current = applyFilterChange;
  const homeResetNonceSeen = useRef(homeResetNonce);

  useEffect(() => {
    if (homeResetNonceSeen.current === homeResetNonce) {
      return;
    }
    homeResetNonceSeen.current = homeResetNonce;
    applyFilterChangeRef.current(defaultResourceFilterState());
    setLibraryEditMode(false);
    setCreateModalOpen(false);
    leaveToList();
  }, [homeResetNonce]);

  // Back on Esc while no dialog is open; open layers take Esc first.
  useEscapeWhenNoLayer(
    (event: KeyboardEvent) => {
      const current = paneRef.current;
      if (current.mode !== "detail") {
        return;
      }
      if (current.target.kind === "plugin-package") {
        const nested = pluginPackageEscapeAction({
          mode: pluginHistoryMode,
          fieldEditing,
          confirmOpen: paneConfirmOpen,
          busy: detailBusy,
        });
        switch (nested) {
          case "cancel-field":
            event.preventDefault();
            cancelFieldEditRef.current?.();
            return;
          case "dismiss-confirm":
          case "noop":
            return;
          case "list":
            leaveToList();
            return;
          case "head":
            event.preventDefault();
            setPluginHistoryMode("head");
            setPluginFrozenVersion(null);
            return;
          case "history":
            event.preventDefault();
            setPluginHistoryMode("history");
            return;
          default: {
            const _exhaustive: never = nested;
            return _exhaustive;
          }
        }
      }
      if (detailBusy) {
        return;
      }
      const action = escapeAction({
        fieldEditing,
        confirmOpen: paneConfirmOpen,
      });
      switch (action) {
        case "cancel-field":
          event.preventDefault();
          cancelFieldEditRef.current?.();
          return;
        case "dismiss-confirm":
          return;
        case "leave-pane":
          event.preventDefault();
          leaveToList();
          return;
        default: {
          const _exhaustive: never = action;
          return _exhaustive;
        }
      }
    },
    pane.mode === "detail",
  );

  function openLibraryRow(entry: LibraryListEntry): void {
    const label = resourceDisplayName(entry, collidingPluginNames);
    setLastSelector(libraryRowSelector(entry));
    switch (entry.listKind) {
      case "plugin-package":
        setPane({
          mode: "detail",
          target: { kind: "plugin-package", selector: entry.name },
        });
        setPluginHistoryMode("head");
        setPluginFrozenVersion(null);
        return;
      case "resource":
        setPane({
          mode: "detail",
          target: {
            kind: "resource",
            selector: entry.id,
            label,
            pathHint: entry.filesystem_path ?? entry.source,
          },
        });
        return;
      default: {
        const _exhaustive: never = entry.listKind;
        return _exhaustive;
      }
    }
  }

  function handleDetailBusy(nextBusy: boolean): void {
    setDetailBusy(nextBusy);
    onBusyChange?.(nextBusy);
  }

  function reloadLibrary(): void {
    setResourcesReloadKey((value) => value + 1);
  }

  async function refreshLibrary(): Promise<boolean> {
    if (!baseUrl) {
      return false;
    }
    try {
      await rescanResourceTrackedDirectories(baseUrl, token);
    } catch (scanError: unknown) {
      setActionError(errorMessage(scanError, "Could not rescan tracked directories"));
      return false;
    }
    await librarySnapshotStore.invalidate();
    reloadLibrary();
    return true;
  }

  function openBulkDelete(): void {
    if (selectedEntries.length === 0 || bulkDeleteBusy) {
      return;
    }
    setBulkDeleteRevealed(LIBRARY_BULK_DELETE_PREVIEW);
    setBulkDeleteOpen(true);
  }

  async function runBulkDelete(): Promise<void> {
    if (!baseUrl || selectedEntries.length === 0) {
      return;
    }
    setBulkDeleteBusy(true);
    setActionError(null);
    const batch = selectedEntries;
    const results = await settleInChunks(
      batch,
      MUTATION_CHUNK_SIZE,
      async (entry) => {
        switch (entry.listKind) {
          case "plugin-package":
            await deleteLibraryPlugin(baseUrl, token, entry.name);
            return;
          case "resource":
            await deleteLibraryResource(
              baseUrl,
              token,
              libraryRowSelector(entry),
              "library",
            );
            return;
          default: {
            const neverKind: never = entry.listKind;
            return neverKind;
          }
        }
      },
    );
    const failed = results.filter((result) => result.status === "rejected");
    const deletedIds = new Set(
      batch
        .filter((_, index) => results[index]?.status === "fulfilled")
        .map((entry) => entry.id),
    );
    const deletedCount = deletedIds.size;
    if (deletedCount > 0) {
      if (batch.some((entry) => entry.listKind === "plugin-package" && deletedIds.has(entry.id))) {
        onProfilesChanged?.();
      }
      onSuccess?.(
        `Deleted ${deletedCount} resource${deletedCount === 1 ? "" : "s"}`,
      );
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const id of deletedIds) {
          next.delete(id);
        }
        return next;
      });
      reloadLibrary();
    }
    setBulkDeleteBusy(false);
    if (failed.length === 0) {
      setBulkDeleteOpen(false);
      setBulkDeleteRevealed(LIBRARY_BULK_DELETE_PREVIEW);
      return;
    }
    const first = failed[0];
    const reason =
      first && first.status === "rejected"
        ? errorMessage(first.reason, "Could not delete resources")
        : "Could not delete resources";
    setActionError(
      failed.length === batch.length
        ? reason
        : `${reason} ${failed.length} of ${batch.length} could not be deleted.`,
    );
  }

  async function runOriginUpdateAll(): Promise<void> {
    if (!baseUrl || originUpdateBusy) {
      return;
    }
    setOriginUpdateBusy(true);
    setActionError(null);
    try {
      const report = await postPluginOriginUpdate(baseUrl, token, { all: true });
      const failed = report.results.find((row) => row.status === "failed");
      if (failed) {
        setActionError(
          failed.message ?? "Could not update plugins from origin",
        );
      } else if (report.summary.updated > 0) {
        onSuccess?.(
          `Updated ${report.summary.updated} plugin${
            report.summary.updated === 1 ? "" : "s"
          } from origin`,
        );
      }
      setOriginUpdateConfirmOpen(false);
    } catch (updateError: unknown) {
      setActionError(
        errorMessage(updateError, "Could not update plugins from origin"),
      );
      setOriginUpdateConfirmOpen(false);
    } finally {
      setOriginUpdateBusy(false);
      reloadLibrary();
    }
  }

  function renderDetail(): ReactNode {
    if (pane.mode !== "detail") {
      return null;
    }
    switch (pane.target.kind) {
      case "resource":
        return (
          <ResourceDetailBody
            chrome="pane"
            Chrome={LibraryDetailChrome}
            target={{
              selector: pane.target.selector,
              label: pane.target.label,
              pathHint: pane.target.pathHint,
            }}
            baseUrl={baseUrl}
            token={token}
            disabled={disabled}
            titleId={detailTitleId}
            onBack={leaveToList}
            onDeleted={leaveToList}
            onOpenOwningPlugin={(pluginName) => {
              setPane({
                mode: "detail",
                target: { kind: "plugin-package", selector: pluginName },
              });
            }}
            onSuccess={onSuccess}
            onLibraryChanged={reloadLibrary}
            onFieldEditingChange={setFieldEditing}
            onRegisterCancelFieldEdit={(cancel) => {
              cancelFieldEditRef.current = cancel;
            }}
            onConfirmOpenChange={setConfirmOpen}
            onBusyChange={handleDetailBusy}
            showBack={false}
            duplicatePluginNames={collidingPluginNames}
          />
        );
      case "plugin-package":
        return (
          <PluginPackageDetail
            selector={pane.target.selector}
            baseUrl={baseUrl}
            token={token}
            disabled={disabled}
            projectPath={resolvedProjectPath || null}
            onBusyChange={handleDetailBusy}
            onSuccess={(message) => onSuccess?.(message)}
            onApplyResult={onApplyResult}
            onProfilesChanged={() => onProfilesChanged?.()}
            onDeleted={() => {
              reloadLibrary();
              leaveToList();
            }}
            onBack={leaveToList}
            onNameCommit={async (name) => {
              setPane({
                mode: "detail",
                target: { kind: "plugin-package", selector: name },
              });
              reloadLibrary();
            }}
            onFieldEditingChange={setFieldEditing}
            onRegisterCancelFieldEdit={(cancel) => {
              cancelFieldEditRef.current = cancel;
            }}
            onConfirmOpenChange={setConfirmOpen}
            onLibraryChanged={reloadLibrary}
            historyMode={pluginHistoryMode}
            frozenVersion={pluginFrozenVersion}
            showBack={false}
            onHistoryModeChange={(mode, nextFrozenVersion) => {
              setPluginHistoryMode(mode);
              setPluginFrozenVersion(nextFrozenVersion ?? null);
            }}
          />
        );
      default: {
        const _exhaustive: never = pane.target;
        return _exhaustive;
      }
    }
  }

  function renderList(): ReactNode {
    if (error && peek == null && full == null) {
      return (
        <EmptyState
          title="Could not load the library"
          body={error}
          action={{
            label: "Retry",
            onClick: () => reloadLibrary(),
            icon: <RefreshCw size={16} aria-hidden />,
          }}
        />
      );
    }
    if (showSkeleton) {
      return <SkeletonRow count={8} height={40} />;
    }
    if (libraryEmpty) {
      return (
        <EmptyState
          title="Nothing in the library yet"
          body="Import items or create a resource."
          action={{
            label: "Create resource",
            primary: true,
            disabled: disabled || !baseUrl,
            onClick: () => setCreateModalOpen(true),
            icon: <Plus size={16} aria-hidden />,
          }}
        >
          <IconActionButton
            label="Import"
            showLabel
            disabled={disabled || !baseUrl}
            onClick={() => setImportOpen(true)}
            icon={<FolderDown size={16} aria-hidden />}
          />
        </EmptyState>
      );
    }
    const typeTabs = libraryEditMode ? (
      <div className="library-list-toolbar">
        <span className="library-edit-check-slot">
          <Checkbox
            data-testid="library-select-all"
            aria-label="Select all"
            checked={selectAllState}
            disabled={disabled || visibleRowIds.length === 0}
            onCheckedChange={() => {
              setSelectedIds((current) =>
                toggleSelectAllVisible(visibleRowIds, current),
              );
            }}
          />
        </span>
        <ResourceTypeTabs
          counts={typeCounts}
          value={typeTab}
          disabled={disabled}
          overflow="collapse"
          onChange={(next) => applyFilterChange({ ...filterState, type: next })}
        />
      </div>
    ) : (
      <ResourceTypeTabs
        counts={typeCounts}
        value={typeTab}
        disabled={disabled}
        overflow="collapse"
        onChange={(next) => applyFilterChange({ ...filterState, type: next })}
      />
    );
    if (listRows.length === 0) {
      if (isResourceFilterStateActive(filterState)) {
        return (
          <>
            {typeTabs}
            <EmptyState
              title={noResultsTitle(filterState.search)}
              body="Clear filters to see everything."
              action={{
                label: "Clear filters",
                onClick: () => applyFilterChange(resetResourceFilterState()),
                icon: <FilterX size={16} aria-hidden />,
              }}
            />
          </>
        );
      }
      return (
        <>
          {typeTabs}
          <EmptyState
            title="No resources to show"
            body="Try another type tab."
          />
        </>
      );
    }
    return (
      <>
        {typeTabs}
        <LibraryResourceList
          rows={listRows}
          inUseIndex={inUseIndex}
          disabled={disabled}
          lastSelector={lastSelector}
          enteringIds={enteringIds}
          libraryEditMode={libraryEditMode}
          selectedIds={selectedIds}
          onToggleSelected={(id) => {
            setSelectedIds((current) => {
              const next = new Set(current);
              if (next.has(id)) {
                next.delete(id);
              } else {
                next.add(id);
              }
              return next;
            });
          }}
          onOpen={openLibraryRow}
          duplicatePluginNames={collidingPluginNames}
        />
      </>
    );
  }

  function renderMainPane(): ReactNode {
    switch (pane.mode) {
      case "detail":
        return renderDetail();
      case "list":
        return renderList();
      default: {
        const _exhaustive: never = pane;
        return _exhaustive;
      }
    }
  }

  const hasLocalPrevious = libraryPaneHasPrevious(pane);
  const backDisabled =
    disabled
    || !workspaceBackEnabled({
      hasLocalPrevious,
      hasWorkspacePrevious: canWorkspaceBack,
    })
    || (hasLocalPrevious && confirmOpen);
  const count = outdatedCount;
  const bulkDeleteLines = selectedEntries.map((entry) => ({
    id: entry.id,
    line: libraryBulkDeleteLine(
      resourceTypeTabLabel(libraryFilterType(entry)),
      resourceDisplayName(entry, collidingPluginNames),
    ),
  }));
  const bulkDeleteVisibleCount = libraryBulkDeleteVisibleCount(
    bulkDeleteLines.length,
    bulkDeleteRevealed,
  );
  const showListFab = pane.mode === "list" && !error;

  return (
    <main
      className={["resources-panel", disconnected ? "is-disconnected" : ""]
        .filter(Boolean)
        .join(" ")}
      aria-label="Library"
      aria-busy={refreshing || undefined}
      data-library-pane={pane.mode}
      data-refreshing={refreshing ? "true" : undefined}
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
                Library
                <WorkspaceRefreshButton
                  testId="library-refresh"
                  label="Refresh library"
                  className="resources-panel-refreshing"
                  disabled={disabled || !baseUrl}
                  onRefresh={refreshLibrary}
                />
              </span>
              <span className="muted resources-panel-scope">
                All registered resources and plugins
              </span>
            </div>
          </div>
          <div className="resources-panel-header-actions">
            {pane.mode === "list" ? (
              <IconActionButton
                data-testid="library-edit-mode"
                label={libraryEditMode ? "Done" : "Edit"}
                aria-pressed={libraryEditMode}
                disabled={disabled || !baseUrl}
                onClick={() => setLibraryEditMode(!libraryEditMode)}
                icon={
                  libraryEditMode ? (
                    <Check size={16} aria-hidden />
                  ) : (
                    <Pencil size={16} aria-hidden />
                  )
                }
              />
            ) : null}
            <IconActionButton
              label="Import"
              title="Import"
              disabled={disabled || !baseUrl}
              onClick={() => setImportOpen(true)}
              icon={<FolderDown size={16} aria-hidden />}
            />
            <IconActionButton
              label="Tracked directories"
              title="Tracked directories"
              disabled={disabled || !baseUrl}
              onClick={() => setTrackedDirsOpen(true)}
              icon={<FolderInput size={16} aria-hidden />}
            />
            <IconActionButton
              label="Update all"
              title="Update all"
              disabled={
                disabled
                || !baseUrl
                || originUpdateBusy
                || detailBusy
                || outdatedCount === 0
              }
              onClick={() => setOriginUpdateConfirmOpen(true)}
              icon={<RefreshCw size={16} aria-hidden />}
            />
          </div>
        </div>
      </div>

      <div className="resources-panel-layout">
        <div>
          <ResourceFilterSidebar
            resources={snapshotEntries}
            state={filterState}
            onChange={applyFilterChange}
            onClear={() => applyFilterChange(resetResourceFilterState())}
            disabled={disabled || showSkeleton || Boolean(error)}
            searchInputRef={filterRef}
          />
        </div>
        <div className="resources-panel-body">
          {actionError ? (
            <div className="banner error" role="alert">
              {actionError}
            </div>
          ) : null}
          {storeErrorBanner && (peek != null || full != null) ? (
            <Banner
              tone="error"
              message={storeErrorBanner}
              onRetry={() => reloadLibrary()}
              onDismiss={() => setDismissedStoreError(storeErrorBanner)}
            />
          ) : null}
          {searchError ? (
            <Banner
              tone="error"
              message={searchError}
            />
          ) : null}
          {pane.mode === "list" ? (
            <div className="library-list-pane">
              {renderMainPane()}
              {showListFab ? (
                <ChromeTooltip
                  content={libraryEditMode ? "Delete selected" : "Add resource"}
                >
                  <button
                    type="button"
                    className={[
                      "scope-inventory-fab",
                      "icon-action",
                      libraryEditMode ? "destructive" : "primary",
                    ].join(" ")}
                    data-testid="library-list-fab"
                    aria-label={
                      libraryEditMode ? "Delete selected" : "Add resource"
                    }
                    disabled={
                      disabled
                      || !baseUrl
                      || bulkDeleteBusy
                      || (libraryEditMode && selectedEntries.length === 0)
                    }
                    onClick={() => {
                      if (libraryEditMode) {
                        openBulkDelete();
                        return;
                      }
                      setCreateModalOpen(true);
                    }}
                  >
                    {libraryEditMode ? (
                      <Trash2 size={20} strokeWidth={2} aria-hidden />
                    ) : (
                      <Plus size={20} strokeWidth={2} aria-hidden />
                    )}
                  </button>
                </ChromeTooltip>
              ) : null}
            </div>
          ) : (
            renderMainPane()
          )}
        </div>
      </div>

      <ConfirmDialog
        open={bulkDeleteOpen}
        title="Delete from library?"
        description={
          <>
            <p className="muted">
              These items will be deleted from the library.
            </p>
            <ul className="library-bulk-delete-list">
              {bulkDeleteLines.slice(0, bulkDeleteVisibleCount).map((item) => (
                <li key={item.id}>{item.line}</li>
              ))}
            </ul>
            {bulkDeleteVisibleCount < bulkDeleteLines.length ? (
              <div className="library-contained-more">
                <button
                  type="button"
                  className="link-btn"
                  disabled={bulkDeleteBusy}
                  onClick={() => {
                    setBulkDeleteRevealed(
                      (current) => current + LIBRARY_BULK_DELETE_PREVIEW,
                    );
                  }}
                >
                  Show more
                </button>
                <button
                  type="button"
                  className="link-btn"
                  disabled={bulkDeleteBusy}
                  onClick={() => {
                    setBulkDeleteRevealed(bulkDeleteLines.length);
                  }}
                >
                  {libraryBulkDeleteShowAllLabel(bulkDeleteLines.length)}
                </button>
              </div>
            ) : null}
          </>
        }
        tone="destructive"
        confirmLabel="Delete"
        confirmBusy={bulkDeleteBusy}
        confirmDisabled={bulkDeleteLines.length === 0}
        onConfirm={() => {
          void runBulkDelete();
        }}
        onCancel={() => {
          if (!bulkDeleteBusy) {
            setBulkDeleteOpen(false);
            setBulkDeleteRevealed(LIBRARY_BULK_DELETE_PREVIEW);
          }
        }}
      />

      <ConfirmDialog
        open={originUpdateConfirmOpen}
        title="Update from origin"
        description={`Update ${count} plugin${count === 1 ? "" : "s"} from origin?`}
        confirmLabel="Update"
        confirmBusy={originUpdateBusy}
        onConfirm={() => {
          void runOriginUpdateAll();
        }}
        onCancel={() => {
          if (!originUpdateBusy) {
            setOriginUpdateConfirmOpen(false);
          }
        }}
      />

      <ResourceTrackedDirectoriesModal
        open={trackedDirsOpen}
        baseUrl={baseUrl}
        token={token}
        disabled={disabled}
        onClose={() => setTrackedDirsOpen(false)}
        onChanged={() => setResourcesReloadKey((value) => value + 1)}
      />

      <ImportLibraryDrawer
        open={importOpen}
        baseUrl={baseUrl}
        token={token}
        projectPath={resolvedProjectPath}
        selectedProfile={selectedProfile ?? null}
        disabled={disabled}
        onClose={() => setImportOpen(false)}
        onImported={(message) => {
          setResourcesReloadKey((value) => value + 1);
          onImported?.(message);
        }}
      />

      <ResourceTypeModal
        open={createModalOpen}
        disabled={disabled || !baseUrl}
        baseUrl={baseUrl}
        token={token}
        onClose={() => setCreateModalOpen(false)}
        onImported={(pluginName) => {
          setCreateModalOpen(false);
          setResourcesReloadKey((value) => value + 1);
          onImported?.(`Imported ${pluginName} from GitHub`);
        }}
        onSelect={(selected) => {
          setCreateModalOpen(false);
          setCreateType(selected);
        }}
      />

      {createType ? (
        <ResourceCreatePanel
          key={createType}
          titleId="resource-create-panel-title"
          type={createType}
          baseUrl={baseUrl}
          token={token}
          disabled={disabled}
          attachProfileName={attachProfileName ?? null}
          pickerResources={pickerResources}
          onClose={() => setCreateType(null)}
          onCreated={(target) => {
            setCreateType(null);
            if (target.kind === "plugin-package") {
              setPane({
                mode: "detail",
                target: { kind: "plugin-package", selector: target.selector },
              });
              setPluginHistoryMode("head");
              setPluginFrozenVersion(null);
            } else {
              setPane({
                mode: "detail",
                target: {
                  kind: "resource",
                  selector: target.selector,
                  label: target.label,
                },
              });
            }
            reloadLibrary();
          }}
          onAddToProfile={
            onAddToProfile
              ? (resource) => onAddToProfile(resource)
              : async () => {}
          }
          onSuccess={onSuccess}
        />
      ) : null}
    </main>
  );
}
