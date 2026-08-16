import { useEffect, useMemo, useRef, useState } from "react";
import { FolderDown, FolderInput, Plus } from "lucide-react";
import { ImportLibraryDrawer } from "./parity/ImportLibraryDrawer";
import { loadRecentProjects } from "../lib/recent-projects";
import { ResourceFilterSidebar } from "./ResourceFilterSidebar";
import { ResourceTrackedDirectoriesModal } from "./ResourceTrackedDirectoriesModal";
import {
  ResourceDetailPane,
  type ResourceDetailTarget,
} from "./ResourceDetailPane";
import { TypeIcon } from "./TypeIcon";
import {
  ResourceRowDescription,
  ResourceRowIdentity,
  ResourceRowMeta,
  ResourceRowRoot,
} from "./ui/resource-row";
import { fetchLibraryResources } from "../lib/agent-client";
import {
  fetchLibraryPluginHeads,
  type LibraryPluginHead,
} from "../lib/api/library-plugins";
import { relatedHarnessesForResourceType } from "../lib/harness-meta";
import {
  libraryRowBadge,
  mergeLibraryList,
  type LibraryListEntry,
} from "../lib/library-list";
import type { LibraryPane } from "../lib/library-pane";
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
  onBusyChange: _onBusyChange,
  onProfilesChanged: _onProfilesChanged,
}: ResourcesPanelProps) {
  const [resources, setResources] = useState<LibraryResource[]>([]);
  const [plugins, setPlugins] = useState<LibraryPluginHead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<ResourceFilterState>(
    defaultResourceFilterState,
  );
  const [detailTarget, setDetailTarget] = useState<ResourceDetailTarget | null>(
    null,
  );
  const [trackedDirsOpen, setTrackedDirsOpen] = useState(false);
  const [resourcesReloadKey, setResourcesReloadKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [pane, setPane] = useState<LibraryPane>({ mode: "list" });
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
        setDetailTarget({
          selector: entry.id,
          label,
          pathHint: entry.source,
        });
        return;
      default: {
        const _exhaustive: never = entry.listKind;
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
              onClick={() =>
                setPane({ mode: "create-draft", name: "", description: "" })
              }
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
        <ResourceFilterSidebar
          resources={entries}
          state={filterState}
          onChange={setFilterState}
          onClear={() => setFilterState(resetResourceFilterState())}
          disabled={disabled || loading || Boolean(error)}
          searchInputRef={filterRef}
        />
        <div className="resources-panel-body">
          {error ? (
            <div className="empty-state">
              <p>{error}</p>
            </div>
          ) : loading ? (
            <p className="muted">Loading resources…</p>
          ) : filteredEntries.length === 0 ? (
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
                    onClick={() =>
                      setPane({ mode: "create-draft", name: "", description: "" })
                    }
                  >
                    Create plugin
                  </button>
                </>
              ) : null}
            </div>
          ) : (
            groups.map((group) => (
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
            ))
          )}
        </div>
      </div>

      <ResourceDetailPane
        open={detailTarget !== null}
        target={detailTarget}
        baseUrl={baseUrl}
        token={token}
        onClose={() => setDetailTarget(null)}
        onSuccess={onSuccess}
        onLibraryChanged={() => setResourcesReloadKey((value) => value + 1)}
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
