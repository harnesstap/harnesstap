import { useEffect, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { shouldCloseDialogOnKey } from "../lib/dialog-dismiss";

export interface FullScreenPanelProps {
  titleId: string;
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  closeLabel: string;
  closeDisabled?: boolean;
  onClose: () => void;
  testId?: string;
  bodyClassName?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function FullScreenPanel({
  titleId,
  title,
  eyebrow,
  subtitle,
  closeLabel,
  closeDisabled = false,
  onClose,
  testId,
  bodyClassName,
  actions,
  children,
}: FullScreenPanelProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldCloseDialogOnKey(event.key, closeDisabled)) {
        return;
      }
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDisabled, onClose]);

  return (
    <div
      className="full-screen-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid={testId}
    >
      <div className="full-screen-panel-header">
        <button
          type="button"
          className="icon-action"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
          disabled={closeDisabled}
        >
          <ArrowLeft size={16} aria-hidden />
        </button>
        <div className="full-screen-panel-heading">
          {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
          <h2 id={titleId}>{title}</h2>
          {subtitle ? (
            <div className="muted full-screen-panel-subtitle">{subtitle}</div>
          ) : null}
        </div>
      </div>
      <div
        className={["full-screen-panel-body", bodyClassName]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </div>
      {actions ? (
        <div className="full-screen-panel-actions">{actions}</div>
      ) : null}
    </div>
  );
}
