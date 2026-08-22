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
  tertiaryLabel?: string;
  tertiaryBusy?: boolean;
  tertiaryDisabled?: boolean;
  onTertiary?: () => void;
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
  tertiaryLabel,
  tertiaryBusy = false,
  tertiaryDisabled = false,
  onTertiary,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const anyBusy = confirmBusy || secondaryBusy || tertiaryBusy;
  const cancelRef = useDialogDismiss(open, onCancel, anyBusy);
  const controlsDisabled = confirmDisabled || anyBusy;

  if (!open) {
    return null;
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (shouldCloseDialogOnBackdrop(event.target, event.currentTarget, anyBusy)) {
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
            disabled={anyBusy}
          >
            {cancelLabel}
          </button>
          {tertiaryLabel && onTertiary ? (
            <button
              className={["btn", tertiaryBusy ? "is-busy" : ""].filter(Boolean).join(" ")}
              type="button"
              disabled={tertiaryDisabled || anyBusy}
              aria-busy={tertiaryBusy}
              onClick={onTertiary}
            >
              {tertiaryBusy ? <ButtonSpinner size={16} /> : null}
              {tertiaryLabel}
            </button>
          ) : null}
          {secondaryLabel && onSecondary ? (
            <button
              className={["btn", secondaryBusy ? "is-busy" : ""].filter(Boolean).join(" ")}
              type="button"
              disabled={secondaryDisabled || anyBusy}
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
