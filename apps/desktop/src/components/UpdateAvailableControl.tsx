import { useCallback, useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
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
import { toast } from "../state/toast-store";
import { ButtonSpinner } from "./ButtonSpinner";
import { ChromeTooltip } from "./ChromeTooltip";
import { Presence } from "./motion/Presence";
import { motionClass } from "./motion/motion-utils";

const HEADER_ICON_SIZE = 18;

let cachedStatus: DesktopUpdateStatus | null = null;
const updateListeners = new Set<() => void>();

function emitUpdateStatus(): void {
  for (const listener of updateListeners) {
    listener();
  }
}

export async function refreshDesktopUpdateStatus(
  baseUrl: string,
  token: string | null,
): Promise<{ status: DesktopUpdateStatus | null; failed: boolean }> {
  try {
    cachedStatus = await fetchDesktopUpdateStatus(baseUrl, token);
    emitUpdateStatus();
    return { status: cachedStatus, failed: false };
  } catch {
    emitUpdateStatus();
    return { status: cachedStatus, failed: true };
  }
}

export function useDesktopUpdateStatus(): DesktopUpdateStatus | null {
  return useSyncExternalStore(
    (listener) => {
      updateListeners.add(listener);
      return () => {
        updateListeners.delete(listener);
      };
    },
    () => cachedStatus,
    () => cachedStatus,
  );
}

export interface UpdateAvailableControlProps {
  baseUrl: string | null;
  token: string | null;
  connected: boolean;
  disabled?: boolean;
  variant?: "icon" | "menuitem";
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
  variant = "icon",
}: UpdateAvailableControlProps) {
  const titleId = useId();
  const status = useDesktopUpdateStatus();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useDialogDismiss(open, () => setOpen(false), busy);

  const refreshStatus = useCallback(async () => {
    if (!baseUrl || !connected) {
      return;
    }
    await refreshDesktopUpdateStatus(baseUrl, token);
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
  const openDialog = () => {
    setError(null);
    setOpen(true);
  };

  let trigger: ReactNode;
  switch (variant) {
    case "menuitem":
      trigger = (
        <button
          type="button"
          role="menuitem"
          className="header-more-item"
          data-testid="open-app-update-more"
          onClick={openDialog}
          disabled={disabled || !connected}
        >
          <ArrowUpCircle size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
          Update available
        </button>
      );
      break;
    case "icon":
      trigger = (
        <ChromeTooltip
          content={`Update available: ${status.currentVersion} → ${latest}`}
        >
          <button
            className="icon-action update-available-action"
            type="button"
            data-testid="open-app-update"
            onClick={openDialog}
            disabled={disabled || !connected}
            aria-label={`Update available: ${status.currentVersion} to ${latest}`}
          >
            <ArrowUpCircle size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
            <span className="update-available-badge" aria-hidden="true" />
          </button>
        </ChromeTooltip>
      );
      break;
    default: {
      const neverVariant: never = variant;
      return neverVariant;
    }
  }

  return (
    <>
      {trigger}
      <Presence
        open={open}
        enter="m-scrim-in"
        exit="m-scrim-out"
        className="dialog-backdrop"
        role="presentation"
        onClick={(event) => {
          if (shouldCloseDialogOnBackdrop(event.target, event.currentTarget, busy)) {
            setOpen(false);
          }
        }}
      >
        {(state) => (
          <div
            className={motionClass("dialog update-available-dialog", "m-rise", state)}
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
        )}
      </Presence>
    </>
  );
}

export interface CheckForUpdatesSectionProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
}

/** Settings → Advanced: re-run the Desktop update check and toast the result. */
export function CheckForUpdatesSection({
  open,
  baseUrl,
  token,
  disabled = false,
}: CheckForUpdatesSectionProps) {
  const [busy, setBusy] = useState(false);

  const onCheck = async () => {
    if (!baseUrl) {
      return;
    }
    setBusy(true);
    const { status, failed } = await refreshDesktopUpdateStatus(baseUrl, token);
    setBusy(false);
    if (failed) {
      toast({ tone: "error", title: "Could not check for updates" });
      return;
    }
    if (!status) {
      return;
    }
    if (status.updateAvailable) {
      const latest = status.latestVersion ?? "newer";
      toast({ tone: "info", title: `Update available: v${latest}` });
      return;
    }
    toast({ tone: "success", title: `Desktop is up to date (v${status.currentVersion})` });
  };

  if (!open) {
    return null;
  }

  return (
    <section className="settings-section" data-testid="check-for-updates">
      <h3>Updates</h3>
      <button
        type="button"
        className={["btn", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
        disabled={disabled || busy || !baseUrl}
        onClick={() => void onCheck()}
        aria-busy={busy}
      >
        {busy ? <ButtonSpinner size={16} /> : null}
        Check for updates
      </button>
    </section>
  );
}
