import { useEffect, useId, useRef, useState } from "react";
import {
  AgentApiError,
  fetchLibraryResourceDetail,
} from "../lib/agent-client";
import type { LibraryResourceDetail } from "../lib/types";

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
}

function displayName(resource: LibraryResourceDetail): string {
  return resource.namespace
    ? `${resource.name}@${resource.namespace}`
    : resource.name;
}

function originLabel(resource: LibraryResourceDetail): string {
  if (resource.origin_ref) {
    return `${resource.origin_kind} (${resource.origin_ref})`;
  }
  return resource.origin_kind;
}

export function ResourceDetailPane({
  open,
  target,
  baseUrl,
  token,
  onClose,
}: ResourceDetailPaneProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<LibraryResourceDetail | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

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
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
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
          setError(
            loadError instanceof AgentApiError
              ? loadError.message
              : loadError instanceof Error
                ? loadError.message
                : "Could not load resource details",
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
  }, [open, target, baseUrl, token]);

  if (!open || !target) {
    return null;
  }

  return (
    <div
      className="dialog-backdrop resource-detail-backdrop"
      role="presentation"
      onClick={onClose}
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
            </>
          ) : (
            <p className="muted">No details available.</p>
          )}
        </div>
      </div>
    </div>
  );
}
