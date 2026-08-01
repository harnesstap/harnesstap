import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bot,
  ArchiveRestore,
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
  X,
} from "lucide-react";
import type { ProfileContentsResource, ProfileStashEntry } from "../lib/types";

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

function formatStashTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function groupResourcesByType(
  resources: ProfileContentsResource[],
): Array<{ type: string; resources: ProfileContentsResource[] }> {
  const byType = new Map<string, ProfileContentsResource[]>();
  for (const resource of resources) {
    const group = byType.get(resource.type) ?? [];
    group.push(resource);
    byType.set(resource.type, group);
  }
  return [...byType.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, grouped]) => ({
      type,
      resources: grouped.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

interface StashBrowseDrawerProps {
  open: boolean;
  entries: ProfileStashEntry[];
  onClose: () => void;
}

export function StashBrowseDrawer({
  open,
  entries,
  onClose,
}: StashBrowseDrawerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedId(entries[0]?.id ?? null);
  }, [entries, open]);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null,
    [entries, selectedId],
  );

  const resourceGroups = useMemo(
    () => groupResourcesByType(selectedEntry?.contents.resources ?? []),
    [selectedEntry],
  );

  if (!open) {
    return null;
  }

  return (
    <div
      className="dialog-backdrop create-profile-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="dialog create-profile-dialog stash-browse-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stash-browse-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="create-profile-header">
          <div>
            <h2 id="stash-browse-title">Stashed profiles</h2>
            <p className="muted stash-browse-subtitle">
              Stashed untracked resources. Right-click Unstash to browse bundles.
            </p>
          </div>
          <button
            type="button"
            className="icon-action"
            aria-label="Close stash browser"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="create-profile-body stash-browse-body">
          <div className="stash-browser">
            <div className="stash-bundle-list" aria-label="Stash bundles">
              {entries.length === 0 ? (
                <p className="muted stash-list-message">No stashed profiles.</p>
              ) : (
                entries.map((entry, index) => {
                  const selected = entry.id === selectedEntry?.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={[
                        "stash-bundle-item",
                        selected ? "selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-selected={selected}
                      onClick={() => setSelectedId(entry.id)}
                    >
                      <strong>{entry.profile_name}</strong>
                      <small>
                        stash@{"{"}
                        {index}
                        {"}"} · {formatStashTimestamp(entry.created_at)}
                      </small>
                      <small>
                        {entry.contents.stack_resource_count} resource
                        {entry.contents.stack_resource_count === 1 ? "" : "s"}
                        {entry.file_changes.length > 0
                          ? ` · ${entry.file_changes.length} file change${entry.file_changes.length === 1 ? "" : "s"}`
                          : ""}
                      </small>
                    </button>
                  );
                })
              )}
            </div>

            <div className="stash-bundle-detail" aria-label="Bundle resources">
              {!selectedEntry ? (
                <p className="muted stash-preview-empty">Select a stash bundle.</p>
              ) : (
                <>
                  <div className="stash-bundle-detail-header">
                    <div className="stash-bundle-detail-title">
                      <ArchiveRestore size={16} aria-hidden="true" />
                      <span>{selectedEntry.profile_name}</span>
                    </div>
                    {selectedEntry.contents.stack_summary ? (
                      <p className="muted">{selectedEntry.contents.stack_summary}</p>
                    ) : null}
                  </div>

                  <div className="stash-bundle-resources">
                    {resourceGroups.length === 0 ? (
                      <p className="muted">This bundle has no material resources.</p>
                    ) : (
                      resourceGroups.map((group) => (
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
                              <li className="resources-list-item" key={`${resource.type}:${resource.name}`}>
                                <div className="resources-list-main">
                                  <span
                                    className="resources-list-name"
                                    title={resource.source || undefined}
                                  >
                                    {resource.name}
                                  </span>
                                  {resource.source ? (
                                    <span className="muted resources-list-source">
                                      {resource.source}
                                    </span>
                                  ) : null}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))
                    )}

                    {selectedEntry.file_changes.length > 0 ? (
                      <section className="stash-file-changes" aria-label="File changes">
                        <h3 className="resources-type-heading">
                          <FileText size={ICON_SIZE} aria-hidden />
                          <span>file changes</span>
                          <span className="muted">{selectedEntry.file_changes.length}</span>
                        </h3>
                        <ul className="stash-file-change-list">
                          {selectedEntry.file_changes.map((change) => (
                            <li key={`${change.path}:${change.type}`}>
                              <span className="mono">{change.path}</span>
                              <span className="muted">{change.type}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="dialog-actions create-profile-actions">
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
