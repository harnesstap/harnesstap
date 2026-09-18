import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { dismissToast, useToasts, type ToastTone } from "../../state/toast-store";

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

/** Bottom-right toast stack. Success toasts auto-dismiss; errors stay until closed. */
export function ToastRegion() {
  const toasts = useToasts();
  return (
    <div className="toast-region" aria-live="polite" aria-label="Notifications">
      {toasts.map((item) => (
        <div
          key={item.id}
          className={`toast ${item.tone}`}
          role={item.tone === "error" ? "alert" : "status"}
          data-testid="toast"
        >
          <span className="toast-icon">{toneIcon(item.tone)}</span>
          <div className="toast-body">
            <div className="toast-title">{item.title}</div>
            {item.detail ? <div className="toast-detail muted">{item.detail}</div> : null}
          </div>
          {item.action ? (
            <button
              type="button"
              className="btn toast-action"
              onClick={() => {
                item.action?.onClick();
                dismissToast(item.id);
              }}
            >
              {item.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className="icon-action toast-close"
            aria-label="Dismiss notification"
            onClick={() => dismissToast(item.id)}
          >
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
