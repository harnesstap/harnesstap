import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  FileCode2,
  FileText,
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
import { fetchLibraryResources } from "../lib/agent-client";
import { relatedHarnessesForResourceType } from "../lib/harness-meta";
import {
  filterLibraryResourcesByProfile,
  filterLibraryResourcesBySearch,
  groupLibraryResourcesByType,
  resourceDisplayName,
} from "../lib/resource-search";
import type { LibraryResource, ProfileContentsResource } from "../lib/types";

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
  selectedProfile: string | null;
  profileResources: ProfileContentsResource[] | null;
  profileContentsLoading: boolean;
  disabled?: boolean;
}

export function ResourcesPanel({
  baseUrl,
  token,
  selectedProfile,
  profileResources,
  profileContentsLoading,
  disabled = false,
}: ResourcesPanelProps) {
  const [resources, setResources] = useState<LibraryResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
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
  }, [baseUrl, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => filterRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const scopedResources = useMemo(() => {
    if (!selectedProfile) {
      return resources;
    }
    // Treat null/undefined as "not resolved yet" so missing contents.resources
    // from older agents cannot crash the panel on profile select.
    if (profileResources == null) {
      return [];
    }
    return filterLibraryResourcesByProfile(resources, profileResources);
  }, [profileResources, resources, selectedProfile]);

  const filteredResources = useMemo(
    () => filterLibraryResourcesBySearch(scopedResources, filter),
    [filter, scopedResources],
  );

  const groups = useMemo(
    () => groupLibraryResourcesByType(filteredResources),
    [filteredResources],
  );

  const scopeLabel = selectedProfile
    ? `Linked to ${selectedProfile}`
    : "All registered resources";

  return (
    <main className="resources-panel" aria-label="Resources">
      <div className="resources-panel-header">
        <div className="resources-panel-title">
          <span>Resources</span>
          <span className="muted resources-panel-scope">{scopeLabel}</span>
        </div>
        <input
          ref={filterRef}
          className="resources-panel-filter"
          type="search"
          placeholder="Filter (skill:name)…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          disabled={disabled || loading}
          aria-label="Filter resources"
        />
      </div>

      <div className="resources-panel-body">
        {error ? (
          <div className="empty-state">
            <p>{error}</p>
          </div>
        ) : loading ? (
          <p className="muted">Loading resources…</p>
        ) : selectedProfile && profileContentsLoading && profileResources == null ? (
          <p className="muted">Resolving profile resources…</p>
        ) : filteredResources.length === 0 ? (
          <div className="empty-state">
            <p className="muted">
              {resources.length === 0
                ? "No registered resources yet."
                : selectedProfile && scopedResources.length === 0
                  ? `No library resources linked to ${selectedProfile}.`
                  : filter.trim()
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
                {group.resources.map((resource) => (
                  <li className="resources-list-item" key={resource.id}>
                    <div className="resources-list-main">
                      <span className="resources-list-name">
                        {resourceDisplayName(resource)}
                      </span>
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
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </main>
  );
}
