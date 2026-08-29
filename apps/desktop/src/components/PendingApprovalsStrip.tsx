import { pendingApprovalCliHint, type PendingApprovalItem } from "../lib/pending-approvals";
import { ButtonSpinner } from "./ButtonSpinner";

export interface PendingApprovalsStripProps {
  items: PendingApprovalItem[];
  busyRef?: string | null;
  onApprove?: (ref: string) => void;
  onDeny?: (ref: string) => void;
}

export function PendingApprovalsStrip({
  items,
  busyRef = null,
  onApprove,
  onDeny,
}: PendingApprovalsStripProps) {
  if (items.length === 0) {
    return null;
  }

  const refs = items.map((item) => item.ref);
  const hint = pendingApprovalCliHint(refs);
  const canDecide = Boolean(onApprove || onDeny);

  return (
    <div className="banner" role="status" data-testid="pending-approvals">
      <div>
        <div className="status-line">
          <span className="pill warn">yellow</span>
          <span>
            Pending executable approvals
          </span>
        </div>
        <ul className="pending-approvals-list">
          {items.map((item) => (
            <li key={item.ref} className="pending-approvals-row">
              <span className="mono">
                {item.ref}
                {item.types.length > 0 ? ` (${item.types.join(", ")})` : ""}
              </span>
              {canDecide ? (
                <span className="banner-actions">
                  {onDeny ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busyRef !== null}
                      aria-busy={busyRef === item.ref}
                      onClick={() => onDeny(item.ref)}
                    >
                      {busyRef === item.ref ? <ButtonSpinner size={14} /> : null}
                      Deny
                    </button>
                  ) : null}
                  {onApprove ? (
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busyRef !== null}
                      aria-busy={busyRef === item.ref}
                      onClick={() => onApprove(item.ref)}
                    >
                      {busyRef === item.ref ? <ButtonSpinner size={14} /> : null}
                      Approve
                    </button>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="muted pending-approvals-hint">
          {hint.approve} · {hint.deny}
        </p>
      </div>
    </div>
  );
}
