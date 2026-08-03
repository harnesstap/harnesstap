import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { ButtonSpinner } from "./ButtonSpinner";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  confirmBusy?: boolean;
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
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const controlsDisabled = confirmDisabled || confirmBusy;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirmBusy) {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel, confirmBusy]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => cancelRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !confirmBusy) {
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
            disabled={confirmBusy}
          >
            {cancelLabel}
          </button>
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
