import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { DuplicateMode } from "../lib/api/library-plugins";
import { defaultDuplicateName, duplicateDialogTitle, duplicateModeCopy, duplicateNameError } from "../lib/duplicate-profile";
import { ConfirmDialog } from "./ConfirmDialog";

export interface DuplicateDialogProps {
  open: boolean;
  sourceName: string;
  /** Names already in the Library; the dialog checks the new name inline. */
  existingNames?: ReadonlySet<string>;
  /** Profiles say "profile"; other plugins say "plugin". */
  isProfile?: boolean;
  busy: boolean;
  onConfirm: (input: { name: string; mode: DuplicateMode }) => void;
  onCancel: () => void;
}

/** One Duplicate flow: include the source as a resource of a new profile (default) or a separate copy. */
export function DuplicateDialog({
  open,
  sourceName,
  existingNames,
  isProfile = true,
  busy,
  onConfirm,
  onCancel,
}: DuplicateDialogProps) {
  const [name, setName] = useState(defaultDuplicateName(sourceName));
  const [mode, setMode] = useState<DuplicateMode>("inherit");
  const copy = duplicateModeCopy(sourceName);
  const nameError = duplicateNameError(name, existingNames ?? new Set());

  useEffect(() => {
    if (open) {
      setName(defaultDuplicateName(sourceName));
      setMode("inherit");
    }
  }, [open, sourceName]);

  return (
    <ConfirmDialog
      open={open}
      title={duplicateDialogTitle(isProfile)}
      confirmLabel="Duplicate"
      confirmBusy={busy}
      confirmDisabled={nameError !== null}
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
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? "plugin-duplicate-name-error" : undefined}
        />
        {nameError && name.trim() ? (
          <p id="plugin-duplicate-name-error" className="cut-versions-field-error" role="alert">
            {nameError}
          </p>
        ) : null}
      </div>
      <RadioGroup
        value={mode}
        onValueChange={(value) => setMode(value as DuplicateMode)}
        className="flex flex-col gap-2"
        aria-label="Duplicate mode"
        disabled={busy}
      >
        {(Object.keys(copy) as DuplicateMode[]).map((key) => (
          <div key={key} className="flex items-start gap-2">
            <RadioGroupItem id={`plugin-duplicate-${key}`} value={key} className="mt-0.5" />
            <Label htmlFor={`plugin-duplicate-${key}`} className="flex flex-col items-start gap-0.5 font-normal">
              <span>{copy[key].label}</span>
              <span className="text-xs text-muted-foreground">{copy[key].hint}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>
      </div>
    </ConfirmDialog>
  );
}
