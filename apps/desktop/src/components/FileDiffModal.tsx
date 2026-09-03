import { useEffect, useId, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  AgentApiError,
  fetchProfileFileDiff,
} from "../lib/agent-client";
import {
  shouldCloseDialogOnBackdrop,
  useDialogDismiss,
} from "../lib/dialog-dismiss";
import type { ProfileFileDiffResult, ViewScope } from "../lib/types";
import { buildUnifiedDiffLines, countUnifiedDiffChanges } from "../lib/unified-diff";

export interface FileDiffModalProps {
  open: boolean;
  path: string | null;
  profileName: string | null;
  scope: ViewScope;
  projectPath?: string | null;
  baseUrl: string | null;
  token: string | null;
  onClose: () => void;
}

export function FileDiffModal({
  open,
  path,
  profileName,
  scope,
  projectPath,
  baseUrl,
  token,
  onClose,
}: FileDiffModalProps) {
  const titleId = useId();
  const closeRef = useDialogDismiss(open, onClose);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<ProfileFileDiffResult | null>(null);

  useEffect(() => {
    if (!open || !path || !profileName || !baseUrl) {
      setDiff(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setDiff(null);
    void fetchProfileFileDiff(baseUrl, token, profileName, {
      path,
      scope,
      ...(scope === "project" && projectPath ? { projectPath } : {}),
    })
      .then((next) => {
        if (!cancelled) {
          setDiff(next);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof AgentApiError
              ? loadError.message
              : loadError instanceof Error
                ? loadError.message
                : "Could not load file diff",
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
  }, [open, path, profileName, scope, projectPath, baseUrl, token]);

  const lines = useMemo(() => {
    if (!diff) {
      return [];
    }
    return buildUnifiedDiffLines(diff.path, diff.current ?? "", diff.expected);
  }, [diff]);

  const changeCounts = useMemo(() => countUnifiedDiffChanges(lines), [lines]);
  const showDiffChrome = !loading && !error && diff !== null;

  if (!open || !path) {
    return null;
  }

  return (
    <div
      className="dialog-backdrop file-diff-backdrop"
      role="presentation"
      onClick={(event) => {
        if (shouldCloseDialogOnBackdrop(event.target, event.currentTarget)) {
          onClose();
        }
      }}
    >
      <div
        className="dialog file-diff-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="file-diff-header">
          <div>
            <div className="file-diff-header-row">
              <div className="eyebrow">Live → after apply</div>
              {showDiffChrome ? (
                <span className="file-diff-counts mono" aria-label="Change counts">
                  <span className="file-diff-count-add">+{changeCounts.added}</span>
                  <span className="file-diff-count-remove">−{changeCounts.removed}</span>
                </span>
              ) : null}
            </div>
            <h2 id={titleId} className="mono">
              {path}
            </h2>
            {showDiffChrome ? (
              <p className="muted file-diff-legend">
                Green = would add · Red = would remove
              </p>
            ) : null}
          </div>
          <button
            ref={closeRef}
            className="icon-btn"
            type="button"
            aria-label="Close file diff"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="file-diff-body">
          {loading ? (
            <p className="muted">Loading diff…</p>
          ) : error ? (
            <div className="banner error" role="alert">
              <div>{error}</div>
            </div>
          ) : (
            <pre className="file-diff-content" aria-label={`Live to after-apply diff for ${path}`}>
              {lines.map((line, index) => (
                <span
                  key={`${line.kind}-${index}`}
                  className={`file-diff-line file-diff-line-${line.kind}`}
                >
                  {line.text || " "}
                </span>
              ))}
            </pre>
          )}
        </div>

        <div className="dialog-actions">
          <button className="btn" type="button" onClick={onClose}>
            <X size={16} aria-hidden />
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
