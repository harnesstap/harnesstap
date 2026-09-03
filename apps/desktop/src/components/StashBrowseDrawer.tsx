import { useCallback, useEffect, useMemo, useState } from "react";
import { ArchiveRestore, FileText, X } from "lucide-react";
import {
  connectAgent,
  fetchProfileStash,
  fetchStatus,
  popProfileStash,
} from "../lib/agent-client";
import {
  applyProfileStash,
  stashApplySuccessMessage,
  stashRestoreDropSuccessMessage,
} from "../lib/api/stash-apply";
import { relatedHarnessesForResourceType } from "../lib/harness-meta";
import { hoverModelFromProfileResource } from "../lib/resource-hover";
import type { ProfileContentsResource, ProfileStashEntry } from "../lib/types";
import { ButtonSpinner } from "./ButtonSpinner";
import { FullScreenPanel } from "./FullScreenPanel";
import {
  ResourceDetailPane,
  type ResourceDetailTarget,
} from "./ResourceDetailPane";
import { TypeIcon } from "./TypeIcon";
import {
  ResourceRowIdentity,
  ResourceRowMeta,
  ResourceRowRoot,
} from "./ui/resource-row";

const ICON_SIZE = 14;

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
  baseUrl?: string | null;
  token?: string | null;
  connected?: boolean;
  switching?: boolean;
}

type StashDrawerAction = "apply" | "restore" | null;

export function StashBrowseDrawer({
  open,
  entries,
  onClose,
  baseUrl,
  token,
  connected,
  switching,
}: StashBrowseDrawerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<{
    baseUrl: string;
    token: string | null;
  } | null>(null);
  const [switchingLive, setSwitchingLive] = useState(false);
  const [overlayEntries, setOverlayEntries] = useState<ProfileStashEntry[] | null>(null);
  const [stashAction, setStashAction] = useState<StashDrawerAction>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<ResourceDetailTarget | null>(
    null,
  );

  const resolvedEntries = overlayEntries ?? entries;
  const stashBusy = stashAction !== null;
  const resolvedBaseUrl = baseUrl ?? session?.baseUrl ?? null;
  const resolvedToken = token ?? session?.token ?? null;
  const resolvedConnected =
    connected ?? Boolean(resolvedBaseUrl && resolvedToken);
  const resolvedSwitching = switching ?? switchingLive;
  const mutateDisabled =
    !resolvedConnected
    || !resolvedBaseUrl
    || !resolvedToken
    || resolvedSwitching
    || stashBusy
    || resolvedEntries.length === 0;

  useEffect(() => {
    if (!open) {
      setOverlayEntries(null);
      setStashAction(null);
      setBannerError(null);
      setBannerSuccess(null);
      setDetailTarget(null);
      return;
    }
    if (baseUrl) {
      setSession({ baseUrl, token: token ?? null });
      return;
    }
    let cancelled = false;
    void connectAgent()
      .then((connection) => {
        if (!cancelled) {
          setSession({
            baseUrl: connection.baseUrl,
            token: connection.token,
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBannerError(
            error instanceof Error ? error.message : "Sidecar connection failed",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, baseUrl, token]);

  useEffect(() => {
    if (!open || !resolvedBaseUrl) {
      return;
    }
    let cancelled = false;
    void fetchStatus(resolvedBaseUrl, "fast")
      .then((status) => {
        if (!cancelled) {
          setSwitchingLive(Boolean(status.switching));
        }
      })
      .catch(() => {
        /* rail already owns live status; ignore poll failure */
      });
    return () => {
      cancelled = true;
    };
  }, [open, resolvedBaseUrl]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedId(resolvedEntries[0]?.id ?? null);
    setDetailTarget(null);
  }, [resolvedEntries, open]);

  const selectedEntry = useMemo(
    () => resolvedEntries.find((entry) => entry.id === selectedId) ?? resolvedEntries[0] ?? null,
    [resolvedEntries, selectedId],
  );

  const resourceGroups = useMemo(
    () => groupResourcesByType(selectedEntry?.contents.resources ?? []),
    [selectedEntry],
  );

  const refreshEntries = useCallback(async () => {
    if (!resolvedBaseUrl) {
      return [];
    }
    const listed = await fetchProfileStash(resolvedBaseUrl, resolvedToken);
    setOverlayEntries(listed.entries);
    return listed.entries;
  }, [resolvedBaseUrl, resolvedToken]);

  const onApplyKeep = useCallback(async () => {
    if (mutateDisabled || !resolvedBaseUrl || !resolvedToken) {
      return;
    }
    setStashAction("apply");
    setBannerError(null);
    setBannerSuccess(null);
    try {
      const result = await applyProfileStash(resolvedBaseUrl, resolvedToken);
      if (result.restored.cancelled) {
        setBannerError("Restore cancelled");
        return;
      }
      await refreshEntries();
      setBannerSuccess(
        stashApplySuccessMessage(result.entry.contents.resources.length),
      );
    } catch (error) {
      setBannerError(
        error instanceof Error ? error.message : "Could not apply stashed profile",
      );
    } finally {
      setStashAction(null);
    }
  }, [mutateDisabled, refreshEntries, resolvedBaseUrl, resolvedToken]);

  const onRestoreDrop = useCallback(async () => {
    if (mutateDisabled || !resolvedBaseUrl || !resolvedToken) {
      return;
    }
    setStashAction("restore");
    setBannerError(null);
    setBannerSuccess(null);
    try {
      const result = await popProfileStash(resolvedBaseUrl, resolvedToken);
      if (result.restored.cancelled) {
        setBannerError("Restore cancelled");
        return;
      }
      const next = await refreshEntries();
      setBannerSuccess(
        stashRestoreDropSuccessMessage(result.entry.contents.resources.length),
      );
      if (next.length === 0) {
        onClose();
      }
    } catch (error) {
      setBannerError(
        error instanceof Error ? error.message : "Could not restore stashed profile",
      );
    } finally {
      setStashAction(null);
    }
  }, [mutateDisabled, onClose, refreshEntries, resolvedBaseUrl, resolvedToken]);

  if (!open) {
    return null;
  }

  return (
    <>
    <FullScreenPanel
      titleId="stash-browse-title"
      title="Stashed profiles"
      subtitle={
        <>
          Untracked resource bundles. Apply (keep) restores files and leaves
          the stash. Restore (drop) restores files and removes it. Both use
          the most recent stash (stash@{"{"}0{"}"}).
        </>
      }
      closeLabel="Close stash browser"
      closeDisabled={stashBusy || detailTarget !== null}
      onClose={onClose}
      bodyClassName="stash-browse-body"
      actions={
        <>
          <button
            className="btn"
            type="button"
            onClick={onClose}
            disabled={stashBusy}
          >
            <X size={16} aria-hidden />
            Close
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => void onApplyKeep()}
            disabled={mutateDisabled}
            title="Restore files from the most recent stash and keep the stash entry"
            aria-label="Restore files from the most recent stash and keep the stash entry"
            aria-busy={stashAction === "apply"}
          >
            {stashAction === "apply" ? <ButtonSpinner size={16} /> : <ArchiveRestore size={16} aria-hidden />}
            Apply (keep)
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={() => void onRestoreDrop()}
            disabled={mutateDisabled}
            title="Restore files from the most recent stash and remove the stash entry"
            aria-label="Restore files from the most recent stash and remove the stash entry"
            aria-busy={stashAction === "restore"}
          >
            {stashAction === "restore" ? <ButtonSpinner size={16} /> : <ArchiveRestore size={16} aria-hidden />}
            Restore (drop)
          </button>
        </>
      }
    >

          {bannerError ? <div className="banner error">{bannerError}</div> : null}
          {bannerSuccess ? <div className="success-flash">{bannerSuccess}</div> : null}
          <div className="stash-browser">
            <div className="stash-bundle-list" aria-label="Stash bundles">
              {resolvedEntries.length === 0 ? (
                <p className="muted stash-list-message">No stashed profiles.</p>
              ) : (
                resolvedEntries.map((entry, index) => {
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
                      onClick={() => {
                        setSelectedId(entry.id);
                        setDetailTarget(null);
                      }}
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
                    {selectedEntry.id !== resolvedEntries[0]?.id ? (
                      <p className="muted">
                        Apply and Restore always use stash@{"{"}0{"}"} (most
                        recent), not the selected older bundle.
                      </p>
                    ) : null}

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
                              <li
                                className="resources-list-item"
                                key={`${resource.type}:${resource.name}`}
                              >
                                <ResourceRowRoot
                                  hover={hoverModelFromProfileResource(resource)}
                                >
                                  <ResourceRowIdentity
                                    type={resource.type}
                                    label={resource.name}
                                    onOpen={() =>
                                      setDetailTarget({
                                        selector:
                                          resource.id
                                          ?? `${resource.type}:${resource.name}`,
                                        label: resource.name,
                                        pathHint: resource.source,
                                      })
                                    }
                                  />
                                  <ResourceRowMeta
                                    harnessIds={relatedHarnessesForResourceType(
                                      resource.type,
                                    )}
                                  />
                                </ResourceRowRoot>
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
    </FullScreenPanel>

      <ResourceDetailPane
        open={detailTarget !== null}
        target={detailTarget}
        baseUrl={resolvedBaseUrl}
        token={resolvedToken}
        onClose={() => setDetailTarget(null)}
      />
    </>
  );
}
