import { useMemo } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  type CutVersionRow,
  validateCutRows,
} from "../lib/cut-versions-form";

export interface CutVersionsModalProps {
  open: boolean;
  rows: CutVersionRow[];
  busy?: boolean;
  onRowsChange: (rows: CutVersionRow[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CutVersionsModal({
  open,
  rows,
  busy = false,
  onRowsChange,
  onConfirm,
  onCancel,
}: CutVersionsModalProps) {
  const errors = useMemo(() => validateCutRows(rows), [rows]);
  const confirmDisabled = Object.keys(errors).length > 0;

  const updateRow = (name: string, newVersion: string) => {
    onRowsChange(
      rows.map((row) =>
        row.name === name ? { ...row, newVersion } : row,
      ),
    );
  };

  return (
    <ConfirmDialog
      open={open}
      title="Cut profile version"
      description={
        <p className="muted">
          Freeze the current working state under a new semver version. The
          previous version is kept in history.
        </p>
      }
      confirmLabel="Cut version"
      confirmDisabled={confirmDisabled}
      confirmBusy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <div className="cut-versions-table-wrap">
        <table className="cut-versions-table">
          <thead>
            <tr>
              <th scope="col">Profile</th>
              <th scope="col">Current</th>
              <th scope="col">New version</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const error = errors[row.name];
              const inputId = `cut-version-${row.name}`;
              return (
                <tr key={row.name}>
                  <td className="mono">{row.name}</td>
                  <td className="mono">{row.currentVersion}</td>
                  <td>
                    <input
                      id={inputId}
                      className={error ? "has-error" : ""}
                      type="text"
                      value={row.newVersion}
                      onChange={(event) =>
                        updateRow(row.name, event.target.value)
                      }
                      disabled={busy}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${inputId}-error` : undefined}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {error ? (
                      <p
                        id={`${inputId}-error`}
                        className="cut-versions-field-error"
                      >
                        {error}
                      </p>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ConfirmDialog>
  );
}
