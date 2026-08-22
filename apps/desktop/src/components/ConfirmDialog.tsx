import { type ReactNode, useId } from "react";
import {
  shouldCloseDialogOnBackdrop,
  useDialogDismiss,
} from "../lib/dialog-dismiss";
import { ButtonSpinner } from "./ButtonSpinner";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  confirmBusy?: boolean;
  secondaryLabel?: string;
  secondaryBusy?: boolean;
  secondaryDisabled?: boolean;
  onSecondary?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

/**
 * Shared confirmation modal for destructive / irreversible actions.
 * Uses the app-wide `.dialog` / `.dialog-backdrop` layout.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  confirmDisabled = false,
  confirmBusy = false,
  secondaryLabel,
  secondaryBusy = false,
  secondaryDisabled = false,
  onSecondary,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useDialogDismiss(open, onCancel, confirmBusy || secondaryBusy);
  const controlsDisabled = confirmDisabled || confirmBusy || secondaryBusy;

  if (!open) {
    return null;
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (shouldCloseDialogOnBackdrop(event.target, event.currentTarget, confirmBusy || secondaryBusy)) {
          onCancel();
        }
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h2 id={titleId}>{title}</h2>
        <div id={descriptionId} className="confirm-dialog-body">
          {typeof description === "string" ? (
            <p className="muted">{description}</p>
          ) : (
            description
          )}
        </div>
        {children}
        <div className="dialog-actions">
          <button
            ref={cancelRef}
            className="btn"
            type="button"
            onClick={onCancel}
            disabled={confirmBusy || secondaryBusy}
          >
            {cancelLabel}
          </button>
          {secondaryLabel && onSecondary ? (
            <button
              className={["btn", secondaryBusy ? "is-busy" : ""].filter(Boolean).join(" ")}
              type="button"
              disabled={secondaryDisabled || confirmBusy || secondaryBusy}
              aria-busy={secondaryBusy}
              onClick={onSecondary}
            >
              {secondaryBusy ? <ButtonSpinner size={16} /> : null}
              {secondaryLabel}
            </button>
          ) : null}
          <button
            className={["btn", "primary", confirmBusy ? "is-busy" : ""]
              .filter(Boolean)
              .join(" ")}
            type="button"
            disabled={controlsDisabled}
            aria-busy={confirmBusy}
            onClick={onConfirm}
          >
            {confirmBusy ? <ButtonSpinner size={16} /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
