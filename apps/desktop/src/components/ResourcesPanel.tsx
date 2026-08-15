import { useEffect, useMemo, useRef, useState } from "react";
import { FolderDown, FolderInput } from "lucide-react";
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
import { relatedHarnessesForResourceType } from "../lib/harness-meta";
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
}: ResourcesPanelProps) {
  const [resources, setResources] = useState<LibraryResource[]>([]);
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
  const resolvedProjectPath =
    (projectPath && projectPath.trim())
    || loadRecentProjects()[0]?.path
    || "";
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!baseUrl) {
      setResources([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchLibraryResources(baseUrl, token)
      .then((next) => {
        if (!cancelled) {
          setResources(next);
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

  const filteredResources = useMemo(
    () => applyLibraryResourceFilters(resources, filterState),
    [filterState, resources],
  );

  const groups = useMemo(
    () => groupLibraryResourcesByType(filteredResources),
    [filteredResources],
  );

  return (
    <main className="resources-panel" aria-label="Items">
      <div className="resources-panel-header">
        <div className="resources-panel-header-row">
          <div className="resources-panel-title">
            <span>Items</span>
            <span className="muted resources-panel-scope">
              All registered resources
            </span>
          </div>
          <button
            type="button"
            className="icon-action"
            aria-label="Import into library"
            title="Import into library"
            disabled={disabled || !baseUrl}
            onClick={() => setImportOpen(true)}
          >
            <FolderDown size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="icon-action resources-panel-tracked-dirs-btn"
            aria-label="Tracked directories"
            title="Show tracked directories for resources"
            disabled={disabled || !baseUrl}
            onClick={() => setTrackedDirsOpen(true)}
          >
            <FolderInput size={16} aria-hidden />
          </button>
        </div>
      </div>

      <div className="resources-panel-layout">
        <ResourceFilterSidebar
          resources={resources}
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
          ) : filteredResources.length === 0 ? (
            <div className="empty-state">
              <p className="muted">
                {resources.length === 0
                  ? "No registered resources yet."
                  : isResourceFilterStateActive(filterState)
                    ? "No matches."
                    : "No resources to show."}
              </p>
              {resources.length === 0 ? (
                <button
                  type="button"
                  className="btn"
                  disabled={disabled || !baseUrl}
                  onClick={() => setImportOpen(true)}
                >
                  Import into library
                </button>
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
                    const label = resourceDisplayName(resource);
                    return (
                      <li className="resources-list-item" key={resource.id}>
                        <ResourceRowRoot
                          hover={hoverModelFromLibraryResource(resource)}
                          testId={`resource-row-${label}`}
                          disabled={disabled}
                        >
                          <ResourceRowIdentity
                            type={resource.type}
                            label={label}
                            onOpen={() =>
                              setDetailTarget({
                                selector: resource.id,
                                label,
                                pathHint: resource.source,
                              })
                            }
                          >
                            {resource.description ? (
                              <ResourceRowDescription>
                                {resource.description}
                              </ResourceRowDescription>
                            ) : null}
                          </ResourceRowIdentity>
                          <ResourceRowMeta
                            harnessIds={relatedHarnessesForResourceType(
                              resource.type,
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
