import { useEffect, useId, useRef, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import {
  AgentApiError,
  fetchLibraryResourceDetail,
} from "../lib/agent-client";
import {
  deleteLibraryResource,
  isResourceConflictError,
  syncLibraryResource,
  type ResourceSyncResult,
} from "../lib/api/resource-mutate";
import { formatOriginKindLabel } from "../lib/resource-filters";
import type { LibraryResourceDetail } from "../lib/types";
import { ButtonSpinner } from "./ButtonSpinner";
import { ConfirmDialog } from "./ConfirmDialog";

export interface ResourceDetailTarget {
  /** Prefer id when known; otherwise `type:name` (optional `@namespace`). */
  selector: string;
  label: string;
  pathHint?: string | null;
}

export interface ResourceDetailPaneProps {
  open: boolean;
  target: ResourceDetailTarget | null;
  baseUrl: string | null;
  token: string | null;
  onClose: () => void;
  disabled?: boolean;
  onSuccess?: (message: string) => void;
  onLibraryChanged?: () => void;
}

function displayName(resource: LibraryResourceDetail): string {
  return resource.namespace
    ? `${resource.name}@${resource.namespace}`
    : resource.name;
}

function originLabel(resource: LibraryResourceDetail): string {
  const kind = formatOriginKindLabel(resource.origin_kind);
  if (resource.origin_ref) {
    return `${kind} (${resource.origin_ref})`;
  }
  return kind;
}

function isUntrackedDetail(resource: LibraryResourceDetail): boolean {
  return (
    resource.origin_kind === "untracked" ||
    resource.id.startsWith("untracked:")
  );
}

function isSyncableDetail(resource: LibraryResourceDetail): boolean {
  return resource.origin_kind === "marketplace_link" || resource.type === "plugin";
}

function quoteResource(resource: { type: string; name: string }): string {
  return `${resource.type} "${resource.name}"`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof AgentApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function ResourceDetailPane({
  open,
  target,
  baseUrl,
  token,
  onClose,
  disabled = false,
  onSuccess,
  onLibraryChanged,
}: ResourceDetailPaneProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<LibraryResourceDetail | null>(null);
  const [preview, setPreview] = useState<ResourceSyncResult | null>(null);
  const [mutating, setMutating] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "overwrite" | null>(null);

  const busy = mutating;
  const actionsLocked = disabled || !baseUrl || loading || busy;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (busy || confirm) {
        return;
      }
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, busy, confirm]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, target?.selector]);

  useEffect(() => {
    if (!open || !target || !baseUrl) {
      setDetail(null);
      setError(null);
      setLoading(false);
      setPreview(null);
      setConfirm(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    setPreview(null);
    void fetchLibraryResourceDetail(baseUrl, token, target.selector, {
      pathHint: target.pathHint,
    })
      .then((next) => {
        if (!cancelled) {
          setDetail(next);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(errorMessage(loadError, "Could not load resource details"));
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
  }, [open, target, baseUrl, token]);

  async function runSync(onConflict: "fail" | "overwrite", dryRun: boolean) {
    if (!baseUrl || !target || !detail) {
      return;
    }
    setMutating(true);
    setError(null);
    try {
      const result = await syncLibraryResource(baseUrl, token, target.selector, {
        dry_run: dryRun,
        on_conflict: onConflict,
      });
      if (dryRun) {
        setPreview(result);
        return;
      }
      setPreview(null);
      onSuccess?.(`Synced ${quoteResource(detail)}`);
      const next = await fetchLibraryResourceDetail(baseUrl, token, target.selector, {
        pathHint: target.pathHint,
      });
      setDetail(next);
      onLibraryChanged?.();
    } catch (syncError: unknown) {
      if (!dryRun && isResourceConflictError(syncError)) {
        setConfirm("overwrite");
        return;
      }
      setError(errorMessage(syncError, "Could not sync resource"));
    } finally {
      setMutating(false);
    }
  }

  async function runDelete() {
    if (!baseUrl || !target || !detail) {
      return;
    }
    setMutating(true);
    setError(null);
    try {
      await deleteLibraryResource(baseUrl, token, target.selector);
      onSuccess?.(`Deleted ${quoteResource(detail)}`);
      onLibraryChanged?.();
      setConfirm(null);
      onClose();
    } catch (deleteError: unknown) {
      setError(errorMessage(deleteError, "Could not delete resource"));
    } finally {
      setMutating(false);
    }
  }

  if (!open || !target) {
    return null;
  }

  const showSync = Boolean(detail && !isUntrackedDetail(detail) && isSyncableDetail(detail));
  const showDelete = Boolean(detail && !isUntrackedDetail(detail));
  const showApply = Boolean(preview && preview.updated.length > 0);

  return (
    <div
      className="dialog-backdrop resource-detail-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy && !confirm) {
          onClose();
        }
      }}
    >
      <div
        className="dialog resource-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="resource-detail-header">
          <div>
            <div className="eyebrow">Resource</div>
            <h2 id={titleId}>{detail ? displayName(detail) : target.label}</h2>
          </div>
          <button
            ref={closeRef}
            className="icon-btn"
            type="button"
            aria-label="Close resource details"
            onClick={onClose}
            disabled={busy}
          >
            ×
          </button>
        </div>

        <div className="resource-detail-body">
          {loading ? (
            <p className="muted">Loading details…</p>
          ) : error ? (
            <div className="banner error" role="alert">
              <div>{error}</div>
              {target.pathHint ? (
                <div className="muted mono resource-detail-path-hint">
                  {target.pathHint}
                </div>
              ) : null}
            </div>
          ) : detail ? (
            <>
              <dl className="resource-detail-kv">
                <div>
                  <dt>Type</dt>
                  <dd>{detail.type.replaceAll("_", " ")}</dd>
                </div>
                {detail.namespace ? (
                  <div>
                    <dt>Namespace</dt>
                    <dd>{detail.namespace}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Path</dt>
                  <dd className="mono">{detail.source || "—"}</dd>
                </div>
                <div>
                  <dt>Origin</dt>
                  <dd>{originLabel(detail)}</dd>
                </div>
                {detail.description ? (
                  <div>
                    <dt>Description</dt>
                    <dd>{detail.description}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Updated</dt>
                  <dd>{detail.updated_at}</dd>
                </div>
              </dl>
              <div className="resource-detail-content-block">
                <div className="resource-detail-content-label">Content</div>
                <pre className="resource-detail-content">{detail.content}</pre>
                {detail.content_truncated ? (
                  <p className="muted resource-detail-truncated">
                    Content truncated for preview.
                  </p>
                ) : null}
              </div>
              {preview ? (
                <div className="resource-detail-sync-preview">
                  <p className="muted">
                    Checked {preview.checked} resource(s) · {preview.updated.length}{" "}
                    updated, {preview.unchanged.length} unchanged,{" "}
                    {preview.skipped.length} skipped, {preview.stale.length} stale
                  </p>
                  {preview.stale.map((entry) => (
                    <p
                      key={`${entry.resource.id}:${entry.reason}`}
                      className="muted"
                    >
                      {entry.resource.type}:{entry.resource.name} — {entry.reason}
                    </p>
                  ))}
                </div>
              ) : null}
              {showSync || showDelete ? (
                <div className="resource-detail-actions">
                  {showSync ? (
                    <button
                      className="btn primary"
                      type="button"
                      disabled={actionsLocked}
                      onClick={() => void runSync("fail", true)}
                    >
                      {busy ? <ButtonSpinner size={14} /> : <RefreshCw size={14} aria-hidden />}
                      Sync
                    </button>
                  ) : null}
                  {showApply ? (
                    <button
                      className="btn primary"
                      type="button"
                      disabled={actionsLocked}
                      onClick={() => void runSync("fail", false)}
                    >
                      {busy ? <ButtonSpinner size={14} /> : null}
                      Apply sync
                    </button>
                  ) : null}
                  {showDelete ? (
                    <button
                      className="btn"
                      type="button"
                      disabled={actionsLocked}
                      onClick={() => setConfirm("delete")}
                    >
                      <Trash2 size={14} aria-hidden />
                      Delete
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <p className="muted">No details available.</p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "delete" && detail !== null}
        title="Delete this resource?"
        description={
          detail
            ? `This removes ${detail.type} "${detail.name}" from the library. Plugins and profiles that referenced it are not edited. On-disk harness files are not deleted.`
            : ""
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmBusy={busy}
        onConfirm={() => void runDelete()}
        onCancel={() => {
          if (!busy) {
            setConfirm(null);
          }
        }}
      />

      <ConfirmDialog
        open={confirm === "overwrite" && detail !== null}
        title="Overwrite library definition?"
        description={
          detail
            ? `The install tree differs from the cached library copy of ${detail.type} "${detail.name}". Continuing overwrites the library definition.`
            : ""
        }
        confirmLabel="Overwrite"
        cancelLabel="Cancel"
        confirmBusy={busy}
        onConfirm={() => {
          setConfirm(null);
          void runSync("overwrite", false);
        }}
        onCancel={() => {
          if (!busy) {
            setConfirm(null);
          }
        }}
      />
    </div>
  );
}
