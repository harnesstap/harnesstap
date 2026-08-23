import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { FolderDown, FolderInput, Plus, RefreshCw } from "lucide-react";
import { ImportLibraryDrawer } from "./parity/ImportLibraryDrawer";
import { loadRecentProjects } from "../lib/recent-projects";
import { ConfirmDialog } from "./ConfirmDialog";
import { LibraryDetailChrome } from "./LibraryDetailChrome";
import { PluginPackageDetail } from "./PluginPackageDetail";
import { ResourceCreatePanel, type PickerResource } from "./ResourceCreatePanel";
import { ResourceDetailBody } from "./ResourceDetailBody";
import { ResourceTypeModal } from "./ResourceTypeModal";
import { ResourceFilterSidebar } from "./ResourceFilterSidebar";
import { ResourceTrackedDirectoriesModal } from "./ResourceTrackedDirectoriesModal";
import { TypeIcon } from "./TypeIcon";
import { WorkspaceBackButton } from "./WorkspaceBackButton";
import {
  ResourceRowDescription,
  ResourceRowIdentity,
  ResourceRowMeta,
  ResourceRowRoot,
} from "./ui/resource-row";
import { AgentApiError, fetchLibraryResources } from "../lib/agent-client";
import {
  fetchLibraryPluginHeads,
  type LibraryPluginHead,
} from "../lib/api/library-plugins";
import {
  fetchPluginOriginCheck,
  postPluginOriginUpdate,
} from "../lib/api/plugin-origin-update";
import { relatedHarnessesForResourceType } from "../lib/harness-meta";
import {
  groupLibraryListByFilterType,
  libraryFilterType,
  libraryRowBadge,
  libraryRowUpdateBadge,
  mergeLibraryList,
  type LibraryListEntry,
} from "../lib/library-list";
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
  resetResourceFilterState,
  type ResourceFilterState,
} from "../lib/resource-filters";
import { hoverModelFromLibraryResource } from "../lib/resource-hover";
import { resourceDisplayName } from "../lib/resource-search";
import { workspaceBackEnabled } from "../lib/screen-history";
import type { LibraryResource } from "../lib/types";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof AgentApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export interface ResourcesPanelProps {
  baseUrl: string | null;
  token: string | null;
  /** Bump to force a library reload (e.g. after header refresh rescans tracked dirs). */
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
  focusPluginName?: string | null;
  onFocusPluginConsumed?: () => void;
  focusResourceSelector?: string | null;
  onFocusResourceConsumed?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onProfilesChanged?: () => void;
  canWorkspaceBack?: boolean;
  onWorkspaceBack?: () => void;
  autoOpenTrackedDirectories?: boolean;
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
  focusPluginName,
  onFocusPluginConsumed,
  focusResourceSelector,
  onFocusResourceConsumed,
  onBusyChange,
  onProfilesChanged,
  canWorkspaceBack = false,
  onWorkspaceBack,
  autoOpenTrackedDirectories = false,
}: ResourcesPanelProps) {
  const [resources, setResources] = useState<LibraryResource[]>([]);
  const [plugins, setPlugins] = useState<LibraryPluginHead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [originOutdatedIds, setOriginOutdatedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [originUpdateBusy, setOriginUpdateBusy] = useState(false);
  const [originUpdateConfirmOpen, setOriginUpdateConfirmOpen] = useState(false);
  const [filterState, setFilterState] = useState<ResourceFilterState>(
    defaultResourceFilterState,
  );
  const [trackedDirsOpen, setTrackedDirsOpen] = useState(autoOpenTrackedDirectories);

  useEffect(() => {
    if (autoOpenTrackedDirectories) {
      setTrackedDirsOpen(true);
    }
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
  const paneRef = useRef(pane);
  paneRef.current = pane;
  const resolvedProjectPath =
    (projectPath && projectPath.trim())
    || loadRecentProjects()[0]?.path
    || "";
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!baseUrl) {
      setResources([]);
      setPlugins([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      fetchLibraryResources(baseUrl, token),
      fetchLibraryPluginHeads(baseUrl, token),
    ])
      .then(([nextResources, nextPlugins]) => {
        if (!cancelled) {
          setResources(nextResources);
          setPlugins(nextPlugins);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load library resources",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, resourcesReloadKey, reloadKey]);

  useEffect(() => {
    if (!baseUrl) {
      setOriginOutdatedIds(new Set());
      return;
    }
    let cancelled = false;
    void fetchPluginOriginCheck(baseUrl, token, { refresh: true })
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

  const entries = useMemo(
    () => mergeLibraryList(resources, plugins, originOutdatedIds),
    [resources, plugins, originOutdatedIds],
  );
  const outdatedCount = useMemo(
    () => entries.filter((entry) => entry.originOutdated).length,
    [entries],
  );

  const pickerResources = useMemo<PickerResource[]>(
    () =>
      entries
        .filter((entry) => entry.type !== "plugin" && entry.type !== "plugin_ref")
        .map((entry) => ({
          id: entry.id,
          type: entry.type,
          name: entry.name,
          namespace: entry.namespace ?? null,
        })),
    [entries],
  );

  const filteredEntries = useMemo(
    () => applyLibraryResourceFilters(entries, filterState),
    [filterState, entries],
  );

  const groups = useMemo(
    () => groupLibraryListByFilterType(filteredEntries),
    [filteredEntries],
  );

  const libraryEmpty = resources.length === 0 && plugins.length === 0;
  const paneConfirmOpen = confirmOpen || originUpdateConfirmOpen;

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
  }, [homeResetNonce]);

  useEffect(() => {
    if (pane.mode !== "detail") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
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
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pane.mode, fieldEditing, paneConfirmOpen, detailBusy, pluginHistoryMode]);

  function openLibraryRow(entry: LibraryListEntry): void {
    const label = resourceDisplayName(entry);
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
            pathHint: entry.source,
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
            onSuccess={onSuccess}
            onLibraryChanged={reloadLibrary}
            onFieldEditingChange={setFieldEditing}
            onConfirmOpenChange={setConfirmOpen}
            onBusyChange={handleDetailBusy}
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
            onConfirmOpenChange={setConfirmOpen}
            onLibraryChanged={reloadLibrary}
            historyMode={pluginHistoryMode}
            frozenVersion={pluginFrozenVersion}
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
    if (error) {
      return (
        <div className="empty-state">
          <p>{error}</p>
        </div>
      );
    }
    if (loading) {
      return <p className="muted">Loading resources…</p>;
    }
    if (filteredEntries.length === 0) {
      return (
        <div className="empty-state">
          <p className="muted">
            {libraryEmpty
              ? "No registered resources yet. Import items or create a resource."
              : isResourceFilterStateActive(filterState)
                ? "No matches."
                : "No resources to show."}
          </p>
          {libraryEmpty ? (
            <>
              <button
                type="button"
                className="btn"
                disabled={disabled || !baseUrl}
                onClick={() => setImportOpen(true)}
              >
                Import into library
              </button>
              <button
                type="button"
                className="btn"
                disabled={disabled || !baseUrl}
                onClick={() => setCreateModalOpen(true)}
              >
                Create resource
              </button>
            </>
          ) : null}
        </div>
      );
    }
    return groups.map((group) => (
      <section
        className="resources-type-group"
        key={group.type}
        aria-label={group.label}
      >
        <h3 className="resources-type-heading">
          <TypeIcon type={group.type} />
          <span>{group.label}</span>
          <span className="muted">{group.resources.length}</span>
        </h3>
        <ul className="resources-list">
          {group.resources.map((entry) => {
            const label = resourceDisplayName(entry);
            const badge = libraryRowBadge(entry);
            const updateBadge = libraryRowUpdateBadge(entry);
            const filterType = libraryFilterType(entry);
            return (
              <li className="resources-list-item" key={entry.id}>
                <ResourceRowRoot
                  hover={hoverModelFromLibraryResource(entry)}
                  testId={`resource-row-${label}`}
                  disabled={disabled}
                >
                  <ResourceRowIdentity
                    type={filterType}
                    label={label}
                    onOpen={() => openLibraryRow(entry)}
                  >
                    {updateBadge ? (
                      <span className="pill warn">{updateBadge}</span>
                    ) : null}
                    {badge || entry.description ? (
                      <ResourceRowDescription>
                        {badge}
                        {badge && entry.description ? " · " : null}
                        {entry.description}
                      </ResourceRowDescription>
                    ) : null}
                  </ResourceRowIdentity>
                  <ResourceRowMeta
                    harnessIds={relatedHarnessesForResourceType(
                      filterType,
                    )}
                  />
                </ResourceRowRoot>
              </li>
            );
          })}
        </ul>
      </section>
    ));
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
    || (hasLocalPrevious && (detailBusy || confirmOpen));
  const count = outdatedCount;

  return (
    <main
      className="resources-panel"
      aria-label="Library"
      data-library-pane={pane.mode}
    >
      <div className="resources-panel-header">
        <div className="resources-panel-header-row">
          <div className="resources-panel-title-cluster">
            <WorkspaceBackButton
              disabled={backDisabled}
              onClick={handlePanelBack}
            />
            <div className="resources-panel-title">
              <span>Library</span>
              <span className="muted resources-panel-scope">
                All registered resources and plugins
              </span>
            </div>
          </div>
          <div className="resources-panel-header-actions">
            <button
              type="button"
              className="btn primary"
              data-testid="library-create-resource"
              aria-label="Create resource"
              title="Create resource"
              disabled={disabled || !baseUrl}
              onClick={() => setCreateModalOpen(true)}
            >
              <Plus size={16} aria-hidden />
              Create resource
            </button>
            <button
              type="button"
              className="btn"
              aria-label="Import into library"
              title="Import into library"
              disabled={disabled || !baseUrl}
              onClick={() => setImportOpen(true)}
            >
              <FolderDown size={16} aria-hidden />
              Import
            </button>
            <button
              type="button"
              className="btn"
              aria-label="Tracked directories"
              title="Show tracked directories for resources"
              disabled={disabled || !baseUrl}
              onClick={() => setTrackedDirsOpen(true)}
            >
              <FolderInput size={16} aria-hidden />
              Tracked directories
            </button>
            <button
              type="button"
              className="btn"
              aria-label="Update all"
              title="Update all outdated plugins from origin"
              disabled={
                disabled
                || !baseUrl
                || originUpdateBusy
                || detailBusy
                || outdatedCount === 0
              }
              onClick={() => setOriginUpdateConfirmOpen(true)}
            >
              <RefreshCw size={16} aria-hidden />
              Update all
            </button>
          </div>
        </div>
      </div>

      <div className="resources-panel-layout">
        <div>
          <ResourceFilterSidebar
            resources={entries}
            state={filterState}
            onChange={applyFilterChange}
            onClear={() => applyFilterChange(resetResourceFilterState())}
            disabled={disabled || loading || Boolean(error)}
            searchInputRef={filterRef}
          />
        </div>
        <div className="resources-panel-body">
          {actionError ? (
            <div className="banner error" role="alert">
              {actionError}
            </div>
          ) : null}
          {renderMainPane()}
        </div>
      </div>

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
        onClose={() => setCreateModalOpen(false)}
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
        />
      ) : null}
    </main>
  );
}
