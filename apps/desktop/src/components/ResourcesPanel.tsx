import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  FileCode2,
  FileText,
  FolderInput,
  Package,
  Plug,
  Shield,
  Sparkles,
  Terminal,
  Variable,
  Webhook,
  Wrench,
} from "lucide-react";
import { RelatedHarnessIcons } from "./HarnessIcons";
import { ResourceFilterSidebar } from "./ResourceFilterSidebar";
import { ResourceTrackedDirectoriesModal } from "./ResourceTrackedDirectoriesModal";
import {
  ResourceDetailPane,
  type ResourceDetailTarget,
} from "./ResourceDetailPane";
import { fetchLibraryResources } from "../lib/agent-client";
import { relatedHarnessesForResourceType } from "../lib/harness-meta";
import {
  applyLibraryResourceFilters,
  defaultResourceFilterState,
  isResourceFilterStateActive,
  resetResourceFilterState,
  type ResourceFilterState,
} from "../lib/resource-filters";
import {
  groupLibraryResourcesByType,
  resourceDisplayName,
} from "../lib/resource-search";
import type { LibraryResource } from "../lib/types";

const ICON_SIZE = 14;

function TypeIcon({ type }: { type: string }): ReactNode {
  switch (type) {
    case "skill":
      return <Sparkles size={ICON_SIZE} aria-hidden />;
    case "mcp_server":
      return <Plug size={ICON_SIZE} aria-hidden />;
    case "instruction":
      return <FileText size={ICON_SIZE} aria-hidden />;
    case "rule":
      return <FileCode2 size={ICON_SIZE} aria-hidden />;
    case "agent":
      return <Bot size={ICON_SIZE} aria-hidden />;
    case "command":
      return <Terminal size={ICON_SIZE} aria-hidden />;
    case "hook":
      return <Webhook size={ICON_SIZE} aria-hidden />;
    case "permission":
      return <Shield size={ICON_SIZE} aria-hidden />;
    case "env_var":
      return <Variable size={ICON_SIZE} aria-hidden />;
    case "plugin_pin":
      return <Package size={ICON_SIZE} aria-hidden />;
    default:
      return <Wrench size={ICON_SIZE} aria-hidden />;
  }
}

export interface ResourcesPanelProps {
  baseUrl: string | null;
  token: string | null;
  /** Bump to force a library reload (e.g. after header refresh rescans tracked dirs). */
  reloadKey?: number;
  disabled?: boolean;
}

export function ResourcesPanel({
  baseUrl,
  token,
  reloadKey = 0,
  disabled = false,
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
    <main className="resources-panel" aria-label="Resources">
      <div className="resources-panel-header">
        <div className="resources-panel-header-row">
          <div className="resources-panel-title">
            <span>Resources</span>
            <span className="muted resources-panel-scope">
              All registered resources
            </span>
          </div>
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
                      <li
                        className="resources-list-item"
                        key={resource.id}
                        data-testid={`resource-row-${label}`}
                      >
                        <div className="resources-list-main">
                          <button
                            type="button"
                            className="resource-name-btn resources-list-name"
                            title={resource.source || undefined}
                            disabled={disabled}
                            onClick={() =>
                              setDetailTarget({
                                selector: resource.id,
                                label,
                                pathHint: resource.source,
                              })
                            }
                          >
                            {label}
                          </button>
                          <RelatedHarnessIcons
                            harnessIds={relatedHarnessesForResourceType(
                              resource.type,
                            )}
                          />
                        </div>
                        {resource.description ? (
                          <span className="resources-list-desc muted">
                            {resource.description}
                          </span>
                        ) : null}
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
      />

      <ResourceTrackedDirectoriesModal
        open={trackedDirsOpen}
        baseUrl={baseUrl}
        token={token}
        disabled={disabled}
        onClose={() => setTrackedDirsOpen(false)}
        onChanged={() => setResourcesReloadKey((value) => value + 1)}
      />
    </main>
  );
}
