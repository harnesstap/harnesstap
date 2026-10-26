import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { MIGRATE_CHOOSE_FILE_COPY, MIGRATE_NO_FILE_COPY } from "../lib/migrate-defaults";

export interface MigrateFilePickerProps {
  label: string;
  icon: ReactNode;
  path: string | null;
  onChoose: () => void;
  disabled?: boolean;
}

/** A labeled "Choose file" button with the chosen path (or a muted hint) beside it. */
export function MigrateFilePicker({ label, icon, path, onChoose, disabled }: MigrateFilePickerProps) {
  return (
    <div className="form-field gap-2">
      <Label>{label}</Label>
      <div className="migrate-file-picker">
        <button className="btn" type="button" onClick={onChoose} disabled={disabled}>
          {icon}
          {MIGRATE_CHOOSE_FILE_COPY}
        </button>
        {path ? (
          <span className="mono text-xs migrate-file-path">{path}</span>
        ) : (
          <span className="muted text-xs">{MIGRATE_NO_FILE_COPY}</span>
        )}
      </div>
    </div>
  );
}
