import { useState } from "react";
import { CloudDownload, Info } from "lucide-react";
import { postPluginOriginUpdate, type PluginOriginUpdateReport } from "../../lib/api/plugin-origin-update";
import {
  dismissUpdate,
  fetchUpdateCheckJob,
  startUpdateCheck,
  type UpdateList,
} from "../../lib/api/updates";
import { handledKey, profileUpdatesBanner } from "../../lib/updates-banner";
import { toast } from "../../state/toast-store";
import { Banner } from "./Banner";

export interface UpdatesBannerProps {
  baseUrl: string | null;
  token: string | null;
  list: UpdateList | null;
  /** The profile whose page this is; the banner only covers updates it uses. */
  profileName: string | null;
  disabled?: boolean;
  onChanged: (next?: UpdateList) => void | Promise<void>;
  onLibraryChanged?: () => void;
  /** After an update ran; B3b hooks the one-time prompt here. */
  onUpdated?: (report: PluginOriginUpdateReport) => void;
}

async function waitForCheck(baseUrl: string, token: string | null): Promise<void> {
  const job = await startUpdateCheck(baseUrl, token);
  const deadline = Date.now() + 60_000;
  let state = job.state;
  while (state === "running" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    state = (await fetchUpdateCheckJob(baseUrl, token, job.job_id)).state;
  }
}

/** Update text for the toast after the banner's Update. */
export function updateResultMessage(report: PluginOriginUpdateReport): string {
  const { updated, skipped, failed } = report.summary;
  if (failed > 0) return `${failed} could not update. ${updated} updated.`;
  if (updated === 0) return "Already up to date at the source.";
  return updated === 1 ? "1 plugin updated." : `${updated} plugins updated.`;
}

/** Neutral banner on the affected profile's own page: Update, or x to dismiss. */
export function UpdatesBanner({
  baseUrl,
  token,
  list,
  profileName,
  disabled,
  onChanged,
  onLibraryChanged,
  onUpdated,
}: UpdatesBannerProps) {
  const [busy, setBusy] = useState<"update" | "dismiss" | null>(null);
  // Versions this session already acted on, so the banner clears at once.
  const [handled, setHandled] = useState<ReadonlySet<string>>(() => new Set());
  const model = list ? profileUpdatesBanner(list.rows, profileName, handled) : null;
  if (!model || !baseUrl) return null;

  const update = async () => {
    setBusy("update");
    try {
      const reports: PluginOriginUpdateReport[] = [];
      for (const name of model.plugins) {
        reports.push(await postPluginOriginUpdate(baseUrl, token, { name }));
      }
      const report: PluginOriginUpdateReport = {
        results: reports.flatMap((entry) => entry.results),
        summary: {
          updated: reports.reduce((sum, entry) => sum + entry.summary.updated, 0),
          skipped: reports.reduce((sum, entry) => sum + entry.summary.skipped, 0),
          failed: reports.reduce((sum, entry) => sum + entry.summary.failed, 0),
        },
      };
      if (report.summary.failed === 0) {
        setHandled((prev) => new Set([...prev, ...model.dismiss.map((entry) => handledKey({ plugin_name: entry.plugin, latest_in_range: entry.version }))]));
      }
      onLibraryChanged?.();
      await waitForCheck(baseUrl, token);
      await onChanged();
      toast({ tone: report.summary.failed > 0 ? "error" : "success", title: updateResultMessage(report) });
      onUpdated?.(report);
    } catch (error) {
      toast({ tone: "error", title: error instanceof Error ? error.message : "Could not update" });
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async () => {
    setBusy("dismiss");
    try {
      let next: UpdateList | undefined;
      for (const entry of model.dismiss) {
        next = await dismissUpdate(baseUrl, token, entry.plugin, entry.version);
      }
      await onChanged(next);
    } catch (error) {
      toast({ tone: "error", title: error instanceof Error ? error.message : "Could not dismiss" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Banner
      tone="neutral"
      role="status"
      testId="updates-banner"
      message={
        <span className="banner-message-with-icon">
          <Info size={16} strokeWidth={2} aria-hidden />
          {model.message}
        </span>
      }
      onDismiss={busy === null && !disabled ? () => void dismiss() : undefined}
    >
      <button
        type="button"
        className="btn primary"
        style={{ width: "auto" }}
        disabled={disabled || busy !== null}
        onClick={() => void update()}
      >
        <CloudDownload size={16} aria-hidden />
        {busy === "update" ? "Updating" : "Update"}
      </button>
    </Banner>
  );
}
