import { type ReactNode, useId } from "react";
import { Check, Trash2, X } from "lucide-react";
import {
  shouldCloseDialogOnBackdrop,
  useDialogDismiss,
} from "../lib/dialog-dismiss";
import { ButtonSpinner } from "./ButtonSpinner";
import { Presence } from "./motion/Presence";
import { motionClass } from "./motion/motion-utils";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  confirmHint?: ReactNode;
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
  tone?: "default" | "destructive";
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
  confirmHint,
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
  tone = "default",
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const anyBusy = confirmBusy || secondaryBusy || tertiaryBusy;
  const cancelRef = useDialogDismiss(open, onCancel, anyBusy);
  const controlsDisabled = confirmDisabled || anyBusy;

  return (
    <Presence
      open={open}
      enter="m-scrim-in"
      exit="m-scrim-out"
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (shouldCloseDialogOnBackdrop(event.target, event.currentTarget, anyBusy)) {
          onCancel();
        }
      }}
    >
      {(state) => (
        <div
          className={motionClass("dialog", "m-rise", state)}
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
          {confirmHint && confirmDisabled ? (
            <p className="confirm-dialog-hint" role="status">
              {confirmHint}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button
              ref={cancelRef}
              className="btn"
              type="button"
              onClick={onCancel}
              disabled={anyBusy}
            >
              {cancelLabel ? <X size={16} aria-hidden /> : null}
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
              className={[
                "btn",
                tone === "destructive" ? "destructive" : "primary",
                confirmBusy ? "is-busy" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              type="button"
              disabled={controlsDisabled}
              title={
                confirmDisabled && typeof confirmHint === "string"
                  ? confirmHint
                  : undefined
              }
              aria-busy={confirmBusy}
              onClick={onConfirm}
            >
              {confirmBusy ? (
                <ButtonSpinner size={16} />
              ) : tone === "destructive" ? (
                <Trash2 size={16} aria-hidden />
              ) : (
                <Check size={16} aria-hidden />
              )}
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </Presence>
  );
}
