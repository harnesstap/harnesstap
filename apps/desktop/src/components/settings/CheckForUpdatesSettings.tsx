import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchDesktopUpdateStatus } from "../../lib/api/self-update";
import { toast } from "../../state/toast-store";
import { ButtonSpinner } from "../ButtonSpinner";

export interface CheckForUpdatesSettingsProps {
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function CheckForUpdatesSettings({
  baseUrl,
  token,
  disabled = false,
}: CheckForUpdatesSettingsProps) {
  const [busy, setBusy] = useState(false);

  const onCheck = async () => {
    if (!baseUrl || busy) {
      return;
    }
    setBusy(true);
    try {
      const status = await fetchDesktopUpdateStatus(baseUrl, token);
      if (status.updateAvailable && status.latestVersion) {
        toast({
          tone: "info",
          title: `Update available: ${status.latestVersion}`,
          detail: `You have ${status.currentVersion}`,
        });
      } else {
        toast({
          tone: "success",
          title: "Desktop is up to date",
          detail: status.currentVersion,
        });
      }
    } catch (checkError) {
      toast({
        tone: "error",
        title: errorMessage(checkError, "Could not check for Desktop updates"),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section" data-testid="check-for-updates-settings">
      <h3>Updates</h3>
      <p className="field-note muted">
        Check GitHub for a newer HarnessTap Desktop build.
      </p>
      <div className="dialog-actions">
        <button
          className={["btn", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
          type="button"
          data-testid="settings-check-for-updates"
          onClick={() => void onCheck()}
          disabled={disabled || !baseUrl || busy}
          aria-busy={busy}
        >
          {busy ? <ButtonSpinner size={16} /> : <RefreshCw size={16} aria-hidden />}
          {busy ? "Checking…" : "Check for updates"}
        </button>
      </div>
    </section>
  );
}
