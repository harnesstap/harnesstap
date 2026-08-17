import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { FolderDown, FolderInput, Plus } from "lucide-react";
import { ImportLibraryDrawer } from "./parity/ImportLibraryDrawer";
import { loadRecentProjects } from "../lib/recent-projects";
import { ConfirmDialog } from "./ConfirmDialog";
import { LibraryDetailChrome } from "./LibraryDetailChrome";
import { PluginCreateDraft } from "./PluginCreateDraft";
import { PluginPackageDetail } from "./PluginPackageDetail";
import { ResourceDetailBody } from "./ResourceDetailBody";
import { ResourceFilterSidebar } from "./ResourceFilterSidebar";
import { ResourceTrackedDirectoriesModal } from "./ResourceTrackedDirectoriesModal";
import { TypeIcon } from "./TypeIcon";
import {
  ResourceRowDescription,
  ResourceRowIdentity,
  ResourceRowMeta,
  ResourceRowRoot,
} from "./ui/resource-row";
import { AgentApiError, fetchLibraryResources } from "../lib/agent-client";
import {
  createLibraryPlugin,
  fetchLibraryPluginHeads,
  type LibraryPluginHead,
} from "../lib/api/library-plugins";
import { relatedHarnessesForResourceType } from "../lib/harness-meta";
import {
  libraryRowBadge,
  mergeLibraryList,
  type LibraryListEntry,
} from "../lib/library-list";
import {
  draftHasTypedContent,
  escapeAction,
  shouldCommitDraftName,
  sidebarChangeAction,
  type LibraryPane,
} from "../lib/library-pane";
import {
  applyLibraryResourceFilters,
  defaultResourceFilterState,
  isResourceFilterStateActive,
  resetResourceFilterState,
  type ResourceFilterState,
} from "../lib/resource-filters";
import { hoverModelFromLibraryResource } from "../lib/resource-hover";
import {
  groupLibraryResourcesByType,
  resourceDisplayName,
} from "../lib/resource-search";
import type { LibraryResource } from "../lib/types";

type DraftDiscardIntent = "list" | "fresh-draft";

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
  disabled?: boolean;
  projectPath?: string | null;
  selectedProfile?: string | null;
  onImported?: (message: string) => void;
  onSuccess?: (message: string) => void;
  focusPluginName?: string | null;
  onFocusPluginConsumed?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onProfilesChanged?: () => void;
}

export function ResourcesPanel({
  baseUrl,
  token,
  reloadKey = 0,
  disabled = false,
  projectPath,
  selectedProfile,
  onImported,
  onSuccess,
  focusPluginName,
  onFocusPluginConsumed,
  onBusyChange,
  onProfilesChanged,
}: ResourcesPanelProps) {
  const [resources, setResources] = useState<LibraryResource[]>([]);
  const [plugins, setPlugins] = useState<LibraryPluginHead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<ResourceFilterState>(
    defaultResourceFilterState,
  );
  const [trackedDirsOpen, setTrackedDirsOpen] = useState(false);
  const [fieldEditing, setFieldEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const detailTitleId = useId();
  const [resourcesReloadKey, setResourcesReloadKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [pane, setPane] = useState<LibraryPane>({ mode: "list" });
  const [pendingFilter, setPendingFilter] = useState<ResourceFilterState | null>(
    null,
  );
  const [filterStateBeforeDraftLeave, setFilterStateBeforeDraftLeave] =
    useState<ResourceFilterState | null>(null);
  const [draftDiscardOpen, setDraftDiscardOpen] = useState(false);
  const [draftDiscardIntent, setDraftDiscardIntent] =
    useState<DraftDiscardIntent>("list");
  const [draftNameError, setDraftNameError] = useState<string | null>(null);
  const [draftGeneration, setDraftGeneration] = useState(0);
  const paneRef = useRef(pane);
  paneRef.current = pane;
  const discardingDraftRef = useRef(false);
  const createInFlightRef = useRef(false);
  const suppressDraftCommitRef = useRef(false);
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
    onFocusPluginConsumed?.();
  }, [focusPluginName, onFocusPluginConsumed]);

  const entries = useMemo(
    () => mergeLibraryList(resources, plugins),
    [resources, plugins],
  );

  const filteredEntries = useMemo(
    () => applyLibraryResourceFilters(entries, filterState),
    [filterState, entries],
  );

  const groups = useMemo(
    () => groupLibraryResourcesByType(filteredEntries),
    [filteredEntries],
  );

  const libraryEmpty = resources.length === 0 && plugins.length === 0;
  const paneConfirmOpen = confirmOpen || draftDiscardOpen;
  const emptyDraft = { mode: "create-draft" as const, name: "", description: "" };

  function beginDraftLeave(): void {
    suppressDraftCommitRef.current = true;
  }

  function leaveToList(): void {
    if (paneRef.current.mode === "create-draft") {
      beginDraftLeave();
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setPane({ mode: "list" });
    setFieldEditing(false);
    setConfirmOpen(false);
    setDetailBusy(false);
    setDraftDiscardOpen(false);
    setDraftNameError(null);
  }

  function openEmptyDraft(): void {
    discardingDraftRef.current = false;
    suppressDraftCommitRef.current = false;
    setDraftGeneration((value) => value + 1);
    setPane(emptyDraft);
    setFieldEditing(false);
    setConfirmOpen(false);
    setDraftDiscardOpen(false);
    setDraftNameError(null);
    setPendingFilter(null);
    setFilterStateBeforeDraftLeave(null);
  }

  function closeDraftDiscard(): void {
    setDraftDiscardOpen(false);
    setPendingFilter(null);
    setFilterStateBeforeDraftLeave(null);
  }

  function confirmDraftDiscard(): void {
    const intent = draftDiscardIntent;
    const nextFilter = pendingFilter;
    discardingDraftRef.current = true;
    closeDraftDiscard();
    switch (intent) {
      case "fresh-draft":
        openEmptyDraft();
        return;
      case "list":
        leaveToList();
        if (nextFilter) {
          setFilterState(nextFilter);
        }
        return;
      default: {
        const _exhaustive: never = intent;
        return _exhaustive;
      }
    }
  }

  function cancelDraftDiscard(): void {
    const previousFilter = filterStateBeforeDraftLeave;
    suppressDraftCommitRef.current = false;
    closeDraftDiscard();
    if (previousFilter) {
      setFilterState(previousFilter);
    }
  }

  function requestLeaveDraft(intent: DraftDiscardIntent): void {
    const current = paneRef.current;
    if (current.mode !== "create-draft") {
      return;
    }
    beginDraftLeave();
    if (!draftHasTypedContent(current)) {
      discardingDraftRef.current = true;
      switch (intent) {
        case "fresh-draft":
          openEmptyDraft();
          return;
        case "list":
          leaveToList();
          if (pendingFilter) {
            setFilterState(pendingFilter);
            setPendingFilter(null);
          }
          return;
        default: {
          const _exhaustive: never = intent;
          return _exhaustive;
        }
      }
    }
    setDraftDiscardIntent(intent);
    setDraftDiscardOpen(true);
  }

  async function commitDraftName(
    reason: "enter" | "blur",
    relatedTarget?: EventTarget | null,
  ): Promise<void> {
    const current = paneRef.current;
    if (current.mode !== "create-draft" || discardingDraftRef.current) {
      return;
    }
    let leaving = false;
    switch (reason) {
      case "enter":
        leaving = false;
        break;
      case "blur":
        leaving = suppressDraftCommitRef.current;
        break;
      default: {
        const _exhaustive: never = reason;
        return _exhaustive;
      }
    }
    if (
      !shouldCommitDraftName({
        leaving,
        name: current.name,
        relatedTarget: reason === "blur" ? relatedTarget : null,
      })
      || !baseUrl
      || createInFlightRef.current
    ) {
      return;
    }
    createInFlightRef.current = true;
    setDetailBusy(true);
    onBusyChange?.(true);
    setDraftNameError(null);
    try {
      const name = current.name.trim();
      const description = current.description.trim();
      const created = await createLibraryPlugin(baseUrl, token, {
        name,
        ...(description ? { description } : {}),
      });
      setPane({
        mode: "detail",
        target: { kind: "plugin-package", selector: created.name },
      });
      setDraftNameError(null);
      reloadLibrary();
    } catch (createError: unknown) {
      setDraftNameError(errorMessage(createError, "Could not create plugin"));
    } finally {
      createInFlightRef.current = false;
      setDetailBusy(false);
      onBusyChange?.(false);
    }
  }

  function requestCreatePlugin(): void {
    const current = paneRef.current;
    if (current.mode === "create-draft" && draftHasTypedContent(current)) {
      beginDraftLeave();
      setDraftDiscardIntent("fresh-draft");
      setDraftDiscardOpen(true);
      return;
    }
    if (current.mode === "detail") {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
    if (current.mode === "create-draft") {
      discardingDraftRef.current = true;
    }
    openEmptyDraft();
  }

  function applyFilterChange(next: ResourceFilterState): void {
    const current = paneRef.current;
    if (current.mode === "create-draft") {
      beginDraftLeave();
    }
    if (current.mode === "list") {
      setFilterState(next);
      return;
    }
    const draftTyped =
      current.mode === "create-draft" && draftHasTypedContent(current);
    const action = sidebarChangeAction({
      busy: detailBusy,
      confirmOpen: paneConfirmOpen,
      draftTyped,
    });
    switch (action) {
      case "block":
        return;
      case "leave-and-apply":
        discardingDraftRef.current = current.mode === "create-draft";
        leaveToList();
        setFilterState(next);
        return;
      case "confirm-discard":
        setPendingFilter(next);
        setFilterStateBeforeDraftLeave(filterState);
        setDraftDiscardIntent("list");
        setDraftDiscardOpen(true);
        return;
      default: {
        const _exhaustive: never = action;
        return _exhaustive;
      }
    }
  }

  useEffect(() => {
    if (pane.mode === "list") {
      discardingDraftRef.current = false;
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
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
          if (paneRef.current.mode === "create-draft") {
            requestLeaveDraft("list");
          } else {
            leaveToList();
          }
          return;
        default: {
          const _exhaustive: never = action;
          return _exhaustive;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pane.mode, fieldEditing, paneConfirmOpen, detailBusy]);

  function openLibraryRow(entry: LibraryListEntry): void {
    const label = resourceDisplayName(entry);
    switch (entry.listKind) {
      case "plugin-package":
        setPane({
          mode: "detail",
          target: { kind: "plugin-package", selector: entry.name },
        });
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
          />
        );
      default: {
        const _exhaustive: never = pane.target;
        return _exhaustive;
      }
    }
  }

  function renderCreateDraft(): ReactNode {
    if (pane.mode !== "create-draft") {
      return null;
    }
    return (
      <PluginCreateDraft
        key={draftGeneration}
        titleId={detailTitleId}
        name={pane.name}
        description={pane.description}
        nameError={draftNameError}
        disabled={disabled || !baseUrl}
        busy={detailBusy}
        onDraftChange={(next) => {
          suppressDraftCommitRef.current = false;
          setPane({
            mode: "create-draft",
            name: next.name,
            description: next.description,
          });
          setDraftNameError(null);
        }}
        onNameCommit={(reason, relatedTarget) => {
          void commitDraftName(reason, relatedTarget);
        }}
        onBack={() => requestLeaveDraft("list")}
        onLeavePointerDown={beginDraftLeave}
        onFieldEditingChange={setFieldEditing}
      />
    );
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
              ? "No registered resources yet. Import items or create a plugin."
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
                onClick={() => requestCreatePlugin()}
              >
                Create plugin
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
        aria-label={group.type}
      >
        <h3 className="resources-type-heading">
          <TypeIcon type={group.type} />
          <span>{group.type}</span>
          <span className="muted">{group.resources.length}</span>
        </h3>
        <ul className="resources-list">
          {group.resources.map((resource) => {
            const entry = resource as LibraryListEntry;
            const label = resourceDisplayName(entry);
            const badge = libraryRowBadge(entry);
            return (
              <li className="resources-list-item" key={entry.id}>
                <ResourceRowRoot
                  hover={hoverModelFromLibraryResource(entry)}
                  testId={`resource-row-${label}`}
                  disabled={disabled}
                >
                  <ResourceRowIdentity
                    type={entry.type}
                    label={label}
                    onOpen={() => openLibraryRow(entry)}
                  >
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
                      entry.type,
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
      case "create-draft":
        return renderCreateDraft();
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

  return (
    <main
      className="resources-panel"
      aria-label="Library"
      data-library-pane={pane.mode}
    >
      <div className="resources-panel-header">
        <div className="resources-panel-header-row">
          <div className="resources-panel-title">
            <span>Library</span>
            <span className="muted resources-panel-scope">
              All registered resources and plugins
            </span>
          </div>
          <div className="resources-panel-header-actions">
            <button
              type="button"
              className="btn primary"
              data-testid="library-create-plugin"
              aria-label="Create plugin"
              title="Create plugin"
              disabled={disabled || !baseUrl}
              onPointerDown={() => {
                if (paneRef.current.mode === "create-draft") {
                  beginDraftLeave();
                }
              }}
              onMouseDown={(event) => {
                if (paneRef.current.mode === "create-draft") {
                  event.preventDefault();
                  beginDraftLeave();
                }
              }}
              onClick={() => {
                const current = paneRef.current;
                if (
                  current.mode === "create-draft"
                  && draftHasTypedContent(current)
                ) {
                  beginDraftLeave();
                  setDraftDiscardIntent("fresh-draft");
                  setDraftDiscardOpen(true);
                  return;
                }
                if (current.mode === "detail") {
                  if (document.activeElement instanceof HTMLElement) {
                    document.activeElement.blur();
                  }
                }
                if (current.mode === "create-draft") {
                  discardingDraftRef.current = true;
                  beginDraftLeave();
                }
                setPane({ mode: "create-draft", name: "", description: "" });
                setDraftGeneration((value) => value + 1);
                setFieldEditing(false);
                setConfirmOpen(false);
                setDraftDiscardOpen(false);
                setDraftNameError(null);
                setPendingFilter(null);
                setFilterStateBeforeDraftLeave(null);
                discardingDraftRef.current = false;
                suppressDraftCommitRef.current = false;
              }}
            >
              <Plus size={16} aria-hidden />
              Create plugin
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
          </div>
        </div>
      </div>

      <div className="resources-panel-layout">
        <div
          onPointerDownCapture={() => {
            if (paneRef.current.mode === "create-draft") {
              beginDraftLeave();
            }
          }}
        >
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
          {renderMainPane()}
        </div>
      </div>

      <ConfirmDialog
        open={draftDiscardOpen}
        title="Discard this plugin?"
        description="This plugin has not been created yet. Typed name and description will be lost."
        confirmLabel="Discard"
        onConfirm={() => confirmDraftDiscard()}
        onCancel={() => cancelDraftDiscard()}
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
    </main>
  );
}
