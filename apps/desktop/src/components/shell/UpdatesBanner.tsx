import { useState } from "react";
import { CloudDownload } from "lucide-react";
import { postPluginOriginUpdate } from "../../lib/api/plugin-origin-update";
import {
  dismissUpdate,
  fetchUpdateCheckJob,
  startUpdateCheck,
  type UpdateList,
} from "../../lib/api/updates";
import { updatesBanner } from "../../lib/updates-banner";
import { toast } from "../../state/toast-store";
import { Banner } from "./Banner";

export interface UpdatesBannerProps {
  baseUrl: string | null;
  token: string | null;
  list: UpdateList | null;
  disabled?: boolean;
  onChanged: (next?: UpdateList) => void | Promise<void>;
  onLibraryChanged?: () => void;
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

/** One banner at the top of the Global view: Update all, or Not now. */
export function UpdatesBanner({ baseUrl, token, list, disabled, onChanged, onLibraryChanged }: UpdatesBannerProps) {
  const [busy, setBusy] = useState<"update" | "dismiss" | null>(null);
  const model = list ? updatesBanner(list.rows) : null;
  if (!model || !baseUrl) return null;

  const updateAll = async () => {
    setBusy("update");
    try {
      const report = await postPluginOriginUpdate(baseUrl, token, { all: true });
      onLibraryChanged?.();
      await waitForCheck(baseUrl, token);
      await onChanged();
      toast({
        tone: report.summary.failed > 0 ? "error" : "success",
        title: `Updated ${report.summary.updated}, skipped ${report.summary.skipped}, failed ${report.summary.failed}`,
      });
    } catch (error) {
      toast({ tone: "error", title: error instanceof Error ? error.message : "Could not update" });
    } finally {
      setBusy(null);
    }
  };

  const notNow = async () => {
    setBusy("dismiss");
    try {
      let next: UpdateList | undefined;
      for (const entry of model.dismiss) {
        next = await dismissUpdate(baseUrl, token, entry.plugin, entry.version);
      }
      await onChanged(next);
    } catch (error) {
      toast({ tone: "error", title: error instanceof Error ? error.message : "Could not set aside" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Banner tone="info" role="status" testId="updates-banner" message={model.message}>
      {model.canUpdateAll ? (
        <button
          type="button"
          className="btn primary"
          style={{ width: "auto" }}
          disabled={disabled || busy !== null}
          onClick={() => void updateAll()}
        >
          <CloudDownload size={16} aria-hidden />
          {busy === "update" ? "Updating" : "Update all"}
        </button>
      ) : null}
      <button
        type="button"
        className="btn"
        style={{ width: "auto" }}
        disabled={disabled || busy !== null}
        onClick={() => void notNow()}
      >
        Not now
      </button>
    </Banner>
  );
}
