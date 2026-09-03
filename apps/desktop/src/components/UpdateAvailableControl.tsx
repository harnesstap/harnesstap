import { useCallback, useEffect, useId, useState } from "react";
import { ArrowUpCircle, X } from "lucide-react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { AgentApiError } from "../lib/api/http";
import {
  applyDesktopUpdate,
  fetchDesktopUpdateStatus,
  type DesktopUpdateStatus,
} from "../lib/api/self-update";
import {
  shouldCloseDialogOnBackdrop,
  useDialogDismiss,
} from "../lib/dialog-dismiss";
import { ButtonSpinner } from "./ButtonSpinner";

const HEADER_ICON_SIZE = 18;

export interface UpdateAvailableControlProps {
  baseUrl: string | null;
  token: string | null;
  connected: boolean;
  disabled?: boolean;
}

function errorMessage(error: unknown): string {
  if (error instanceof AgentApiError || error instanceof Error) {
    return error.message;
  }
  return "Could not update HarnessTap Desktop";
}

export function UpdateAvailableControl({
  baseUrl,
  token,
  connected,
  disabled = false,
}: UpdateAvailableControlProps) {
  const titleId = useId();
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useDialogDismiss(open, () => setOpen(false), busy);

  const refreshStatus = useCallback(async () => {
    if (!baseUrl || !connected) {
      setStatus(null);
      return;
    }
    try {
      const next = await fetchDesktopUpdateStatus(baseUrl, token);
      setStatus(next);
    } catch {
      setStatus(null);
    }
  }, [baseUrl, connected, token]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  async function onApply() {
    if (!baseUrl) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await applyDesktopUpdate(baseUrl, token);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!status?.updateAvailable) {
    return null;
  }

  const latest = status.latestVersion ?? "newer";

  return (
    <>
      <button
        className="icon-action update-available-action"
        type="button"
        data-testid="open-app-update"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={disabled || !connected}
        aria-label={`Update available: ${status.currentVersion} to ${latest}`}
        title={`Update available: ${status.currentVersion} → ${latest}`}
      >
        <ArrowUpCircle size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
        <span className="update-available-badge" aria-hidden="true" />
      </button>
      {open ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onClick={(event) => {
            if (shouldCloseDialogOnBackdrop(event.target, event.currentTarget, busy)) {
              setOpen(false);
            }
          }}
        >
          <div
            className="dialog update-available-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="app-update-dialog"
          >
            <h2 id={titleId}>Update available</h2>
            <p className="muted">
              HarnessTap Desktop {status.currentVersion} → {latest}
            </p>
            {status.notes.trim().length > 0 ? (
              <pre className="update-available-notes">{status.notes.trim()}</pre>
            ) : (
              <p className="muted">Release notes were not included with this version.</p>
            )}
            {error ? (
              <div className="banner error" role="alert">
                {error}
              </div>
            ) : null}
            <div className="dialog-actions">
              <button
                ref={closeRef}
                className="btn"
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                <X size={16} aria-hidden />
                Close
              </button>
              <a
                className="link-btn"
                href={status.htmlUrl}
                onClick={(event) => {
                  event.preventDefault();
                  void openUrl(status.htmlUrl);
                }}
              >
                GitHub release
              </a>
              <button
                className={["btn", "primary", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
                type="button"
                onClick={() => void onApply()}
                disabled={busy || !status.asset}
                aria-busy={busy}
              >
                {busy ? <ButtonSpinner size={16} /> : <ArrowUpCircle size={16} aria-hidden />}
                {busy ? "Downloading…" : "Update"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
