import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { dismissToast, useToasts, type Toast, type ToastTone } from "../../state/toast-store";

function toneIcon(tone: ToastTone) {
  switch (tone) {
    case "success":
      return <CircleCheck size={16} strokeWidth={2} aria-hidden="true" />;
    case "error":
      return <CircleAlert size={16} strokeWidth={2} aria-hidden="true" />;
    case "info":
      return <Info size={16} strokeWidth={2} aria-hidden="true" />;
    default: {
      const neverTone: never = tone;
      return neverTone;
    }
  }
}

export function ToastCard({
  item,
  onAction,
  onDismiss,
}: {
  item: Pick<Toast, "tone" | "title" | "detail" | "action">;
  onAction?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={`toast ${item.tone}${item.action ? " has-action" : ""}`}
      role={item.tone === "error" ? "alert" : "status"}
      data-testid="toast"
    >
      <span className="toast-icon">{toneIcon(item.tone)}</span>
      <div className="toast-body">
        <div className="toast-title">{item.title}</div>
        {item.detail ? <div className="toast-detail muted">{item.detail}</div> : null}
        {item.action ? (
          <button
            type="button"
            className="btn toast-action"
            onClick={onAction}
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="icon-action toast-close"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Bottom-right toast stack. Success toasts auto-dismiss; errors stay until closed. */
export function ToastRegion() {
  const toasts = useToasts();
  return (
    <div className="toast-region" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((item) => (
        <ToastCard
          key={item.id}
          item={item}
          onAction={() => {
            item.action?.onClick();
            dismissToast(item.id);
          }}
          onDismiss={() => dismissToast(item.id)}
        />
      ))}
    </div>
  );
}
