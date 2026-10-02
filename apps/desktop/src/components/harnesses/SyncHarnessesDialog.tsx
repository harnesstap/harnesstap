import type { ReactNode } from "react";
import {
  formatHarnessSyncChangeSummary,
  syncHarnessesConfirmBody,
  type HarnessSyncChangeKinds,
  type HarnessSyncPreviewState,
} from "../../lib/harness-sync";
import { ButtonSpinner } from "../ButtonSpinner";
import { ConfirmDialog } from "../ConfirmDialog";
import { HarnessIcon } from "../HarnessIcons";

export interface SyncHarnessesDialogProps {
  open: boolean;
  preview: HarnessSyncPreviewState;
  syncing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const HARNESS_SYNC_KIND_BADGES: ReadonlyArray<{
  key: keyof HarnessSyncChangeKinds;
  kindClass: "add" | "remove" | "update";
  mark: string;
  label: string;
}> = [
  { key: "added", kindClass: "add", mark: "+", label: "added" },
  { key: "removed", kindClass: "remove", mark: "−", label: "removed" },
  { key: "modified", kindClass: "update", mark: "~", label: "modified" },
];

function HarnessSyncChangeBadges({
  counts,
}: {
  counts: HarnessSyncChangeKinds;
}): ReactNode {
  const summary = formatHarnessSyncChangeSummary(counts);
  const badges = HARNESS_SYNC_KIND_BADGES.flatMap(({ key, kindClass, mark, label }) => {
    const count = counts[key];
    if (count <= 0) return [];
    return [
      <span
        key={key}
        className={`file-change-kind-badge apply-diff-kind-badge static ${kindClass}`}
        aria-label={`${count} ${label}`}
      >
        <span className="file-change-kind-mark" aria-hidden>
          {mark}
        </span>
        <span>{count}</span>
      </span>,
    ];
  });
  if (badges.length === 0) {
    return <span className="sr-only">{summary}</span>;
  }
  return (
    <div
      className="harness-sync-preview-badges file-change-kind-badges apply-diff-kind-badges"
      role="group"
      aria-label={summary}
    >
      {badges}
    </div>
  );
}

function PreviewBody({ preview }: { preview: HarnessSyncPreviewState }): ReactNode {
  switch (preview.kind) {
    case "loading":
      return (
        <p className="muted harness-sync-preview-status" role="status" aria-live="polite">
          <ButtonSpinner size={16} />
          Counting resource changes…
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
              <HarnessSyncChangeBadges counts={row} />
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
      description={syncHarnessesConfirmBody()}
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
