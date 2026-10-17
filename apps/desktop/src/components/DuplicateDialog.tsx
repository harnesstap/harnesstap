import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { DuplicateMode } from "../lib/api/library-plugins";
import { DUPLICATE_MODE_COPY, defaultDuplicateName } from "../lib/duplicate-profile";
import { ConfirmDialog } from "./ConfirmDialog";

export interface DuplicateDialogProps {
  open: boolean;
  sourceName: string;
  busy: boolean;
  onConfirm: (input: { name: string; mode: DuplicateMode }) => void;
  onCancel: () => void;
}

/** One Duplicate flow: keep in sync with the source (default) or a separate copy. */
export function DuplicateDialog({ open, sourceName, busy, onConfirm, onCancel }: DuplicateDialogProps) {
  const [name, setName] = useState(defaultDuplicateName(sourceName));
  const [mode, setMode] = useState<DuplicateMode>("inherit");

  useEffect(() => {
    if (open) {
      setName(defaultDuplicateName(sourceName));
      setMode("inherit");
    }
  }, [open, sourceName]);

  return (
    <ConfirmDialog
      open={open}
      title={`Duplicate ${sourceName}`}
      description="Library resources are shared, not copied."
      confirmLabel="Duplicate"
      confirmBusy={busy}
      confirmDisabled={!name.trim()}
      onConfirm={() => onConfirm({ name: name.trim(), mode })}
      onCancel={() => {
        if (!busy) {
          onCancel();
        }
      }}
    >
      <div className="flex flex-col gap-3">
      <div className="form-field">
        <Label htmlFor="plugin-duplicate-name">Name</Label>
        <Input
          id="plugin-duplicate-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
        />
      </div>
      <RadioGroup
        value={mode}
        onValueChange={(value) => setMode(value as DuplicateMode)}
        className="flex flex-col gap-2"
        aria-label="Duplicate mode"
        disabled={busy}
      >
        {(Object.keys(DUPLICATE_MODE_COPY) as DuplicateMode[]).map((key) => (
          <div key={key} className="flex items-start gap-2">
            <RadioGroupItem id={`plugin-duplicate-${key}`} value={key} className="mt-0.5" />
            <Label htmlFor={`plugin-duplicate-${key}`} className="flex flex-col items-start gap-0.5 font-normal">
              <span>{DUPLICATE_MODE_COPY[key].label}</span>
              <span className="text-xs text-muted-foreground">{DUPLICATE_MODE_COPY[key].hint}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>
      </div>
    </ConfirmDialog>
  );
}
