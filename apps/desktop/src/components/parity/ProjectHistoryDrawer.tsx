import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  fetchProjectHistory,
  ProjectHistoryApiError,
  revertProjectSnapshot,
  type ProjectHistorySnapshot,
} from "../../lib/api/project-history";
import { ConfirmDialog } from "../ConfirmDialog";

export interface ProjectHistoryDrawerProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  connected?: boolean;
  switching?: boolean;
  projectPath: string | null;
  disabled?: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onProfilesChanged?: () => void;
}

function shortenId(value: string): string {
  if (value.length <= 10) {
    return value;
  }
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const diffMs = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return `${Math.max(1, Math.floor(diffMs / 1000))} seconds ago`;
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} minutes ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} hours ago`;
  if (diffMs <= 30 * day) return `${Math.floor(diffMs / day)} days ago`;
  return date.toISOString().slice(0, 10);
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function ProjectHistoryDrawer({
  open,
  baseUrl,
  token,
  connected,
  switching,
  projectPath,
  disabled,
  onClose,
  onSuccess,
  onProfilesChanged,
}: ProjectHistoryDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<ProjectHistorySnapshot[]>([]);
  const [projectLinked, setProjectLinked] = useState(true);
  const [originHints, setOriginHints] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ProjectHistorySnapshot | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const chromeBlocked = disabled ?? Boolean(!connected || switching);
  const revertBlocked = chromeBlocked || confirmBusy;

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending && !confirmBusy) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmBusy, onClose, open, pending]);

  useEffect(() => {
    if (!open || !baseUrl || !projectPath) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOriginHints(null);
    setFilter("");
    setPending(null);
    void fetchProjectHistory(baseUrl, projectPath)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setSnapshots(result.snapshots);
        setProjectLinked(result.project_linked);
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }
        if (loadError instanceof ProjectHistoryApiError && loadError.code === "no_git_origin") {
          setOriginHints(loadError.hints);
          setSnapshots([]);
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Could not load history.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, open, projectPath]);

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) {
      return snapshots;
    }
    return snapshots.filter((row) => {
      return row.label.toLowerCase().includes(query) || row.id.toLowerCase().includes(query);
    });
  }, [filter, snapshots]);

  const reload = () => {
    if (!baseUrl || !projectPath) {
      return;
    }
    setLoading(true);
    void fetchProjectHistory(baseUrl, projectPath)
      .then((result) => {
        setSnapshots(result.snapshots);
        setProjectLinked(result.project_linked);
        setOriginHints(null);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof ProjectHistoryApiError && loadError.code === "no_git_origin") {
          setOriginHints(loadError.hints);
          setSnapshots([]);
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Could not load history.");
      })
      .finally(() => setLoading(false));
  };

  const confirmRevert = async () => {
    if (!baseUrl || !projectPath || !pending || revertBlocked) {
      return;
    }
    setConfirmBusy(true);
    try {
      const result = await revertProjectSnapshot(baseUrl, token, {
        snapshotId: pending.id,
        projectPath,
      });
      const shortId = shortenId(result.snapshot.id);
      onSuccess(`Restored ${formatCount(result.restored_file_count, "file")} from snapshot ${shortId}.`);
      onProfilesChanged?.();
      setPending(null);
      reload();
    } catch (revertError: unknown) {
      setError(revertError instanceof Error ? revertError.message : "Could not revert snapshot.");
      setPending(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  if (!open) {
    return null;
  }

  const confirmDescription = pending
    ? `Restoring snapshot ${shortenId(pending.id)} (${formatRelativeTime(pending.created_at)}${
        pending.label ? `, ${pending.label}` : ""
      }) will overwrite harness files in this project with the snapshot contents. Live edits in those paths cannot be restored.`
    : "";

  return (
    <>
      <div
        className="dialog-backdrop create-profile-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !confirmBusy) {
            onClose();
          }
        }}
      >
        <div
          className="dialog create-profile-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-history-title"
        >
          <div className="create-profile-header">
            <div>
              <div className="eyebrow">Project</div>
              <h2 id="project-history-title">History</h2>
              <p className="muted">Configuration snapshots for this project.</p>
            </div>
            <button
              ref={closeRef}
              className="icon-btn"
              type="button"
              aria-label="Close history"
              onClick={onClose}
              disabled={confirmBusy}
            >
              ×
            </button>
          </div>

          <div className="create-profile-body">
            {originHints ? (
              <div className="banner error" role="alert">
                <div>No git remote origin configured.</div>
                {originHints.map((hint) => (
                  <p className="muted" key={hint}>{hint}</p>
                ))}
              </div>
            ) : null}
            {error ? <div className="banner error" role="alert">{error}</div> : null}
            {!originHints ? (
              <>
                <Input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Filter snapshots…"
                  aria-label="Filter snapshots"
                  disabled={loading}
                />
                {loading ? <p className="muted">Loading snapshots…</p> : null}
                {!loading && projectLinked && snapshots.length === 0 ? (
                  <p className="muted">No snapshots found.</p>
                ) : null}
                {!loading && !projectLinked && snapshots.length === 0 ? (
                  <p className="muted">
                    No project record found. Apply or scan this repository first.
                  </p>
                ) : null}
                {!loading && snapshots.length > 0 && filtered.length === 0 ? (
                  <p className="muted">No matches.</p>
                ) : null}
                <ul className="stash-bundle-list">
                  {filtered.map((row) => (
                    <li key={row.id} className="stash-bundle-item">
                      <div>
                        <div>{formatRelativeTime(row.created_at)}</div>
                        <div>{row.label}</div>
                        <div className="mono muted">{shortenId(row.id)}</div>
                      </div>
                      <button
                        className="btn"
                        type="button"
                        disabled={revertBlocked}
                        onClick={() => setPending(row)}
                      >
                        Revert
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={pending !== null}
        title="Revert to this snapshot?"
        description={confirmDescription}
        confirmLabel="Revert"
        cancelLabel="Cancel"
        confirmBusy={confirmBusy}
        confirmDisabled={revertBlocked && !confirmBusy}
        onConfirm={() => {
          void confirmRevert();
        }}
        onCancel={() => {
          if (!confirmBusy) {
            setPending(null);
          }
        }}
      />
    </>
  );
}
