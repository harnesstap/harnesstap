import { useEffect, useState } from "react";
import type { UpdateFrequency, UpdateMode, UpdateSettings } from "../../lib/api/settings-updates";
import { KEEP_UP_TO_DATE_TITLE } from "../../lib/update-settings-copy";
import { ConfirmDialog } from "../ConfirmDialog";
import { UpdatePreferenceFields } from "../settings/UpdatePreferenceFields";

export interface KeepUpToDateDialogProps {
  open: boolean;
  initial: UpdateSettings | null;
  busy?: boolean;
  onSave: (choice: { mode: UpdateMode; frequency: UpdateFrequency }) => void;
  /** Not now: keeps the current choice and does not ask again. */
  onDismiss: () => void;
}

/** Shown once, after the first successful Update all. */
export function KeepUpToDateDialog({ open, initial, busy = false, onSave, onDismiss }: KeepUpToDateDialogProps) {
  const [mode, setMode] = useState<UpdateMode>(initial?.mode ?? "notify");
  const [frequency, setFrequency] = useState<UpdateFrequency>(initial?.frequency ?? "daily");

  useEffect(() => {
    if (open) {
      setMode(initial?.mode ?? "notify");
      setFrequency(initial?.frequency ?? "daily");
    }
  }, [initial, open]);

  return (
    <ConfirmDialog
      open={open}
      title={KEEP_UP_TO_DATE_TITLE}
      description="You can change this later in Settings."
      confirmLabel="Save"
      cancelLabel="Not now"
      confirmBusy={busy}
      onConfirm={() => onSave({ mode, frequency })}
      onCancel={onDismiss}
    >
      <UpdatePreferenceFields
        idPrefix="keep-up-to-date"
        legend="Plugin updates"
        mode={mode}
        frequency={frequency}
        disabled={busy}
        onModeChange={setMode}
        onFrequencyChange={setFrequency}
      />
    </ConfirmDialog>
  );
}
