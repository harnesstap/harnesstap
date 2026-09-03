import { pendingApprovalCliHint, type PendingApprovalItem } from "../lib/pending-approvals";
import { Ban, Check } from "lucide-react";
import { IconActionButton } from "./IconActionButton";

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
                    <IconActionButton
                      label="Deny"
                      disabled={busyRef !== null}
                      busy={busyRef === item.ref}
                      spinnerSize={14}
                      onClick={() => onDeny(item.ref)}
                      icon={<Ban size={16} aria-hidden />}
                    />
                  ) : null}
                  {onApprove ? (
                    <IconActionButton
                      primary
                      label="Approve"
                      disabled={busyRef !== null}
                      busy={busyRef === item.ref}
                      spinnerSize={14}
                      onClick={() => onApprove(item.ref)}
                      icon={<Check size={16} aria-hidden />}
                    />
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
