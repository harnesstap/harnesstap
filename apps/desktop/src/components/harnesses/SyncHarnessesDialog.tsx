import type { ReactNode } from "react";
import {
  formatHarnessSyncChangeCount,
  syncHarnessesConfirmBody,
  type HarnessSyncPreviewState,
} from "../../lib/harness-sync";
import { ButtonSpinner } from "../ButtonSpinner";
import { ConfirmDialog } from "../ConfirmDialog";
import { HarnessIcon } from "../HarnessIcons";

export interface SyncHarnessesDialogProps {
  open: boolean;
  mainName: string;
  preview: HarnessSyncPreviewState;
  syncing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function PreviewBody({ preview }: { preview: HarnessSyncPreviewState }): ReactNode {
  switch (preview.kind) {
    case "loading":
      return (
        <p className="muted harness-sync-preview-status" role="status" aria-live="polite">
          <ButtonSpinner size={16} />
          Counting changes…
        </p>
      );
    case "error":
      return (
        <p className="muted harness-sync-preview-status" role="status">
          {preview.message}
        </p>
      );
    case "ready":
      return (
        <ul className="harness-sync-preview-list">
          {preview.rows.map((row) => (
            <li key={row.id} className="harness-sync-preview-row">
              <HarnessIcon id={row.id} tooltip={false} />
              <span className="harness-sync-preview-name">{row.name}</span>
              <span className="harness-sync-preview-count">
                {formatHarnessSyncChangeCount(row.changes)}
              </span>
            </li>
          ))}
        </ul>
      );
    default: {
      const exhaustive: never = preview;
      return exhaustive;
    }
  }
}

export function SyncHarnessesDialog({
  open,
  mainName,
  preview,
  syncing,
  onConfirm,
  onCancel,
}: SyncHarnessesDialogProps) {
  const counting = preview.kind === "loading";
  return (
    <ConfirmDialog
      open={open}
      title="Sync harnesses"
      description={syncHarnessesConfirmBody(mainName)}
      confirmLabel={syncing ? "Syncing…" : "Sync"}
      confirmBusy={syncing}
      confirmDisabled={counting}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <div
        className="harness-sync-preview"
        data-testid="sync-harnesses-preview"
        aria-busy={counting}
      >
        <PreviewBody preview={preview} />
      </div>
    </ConfirmDialog>
  );
}
