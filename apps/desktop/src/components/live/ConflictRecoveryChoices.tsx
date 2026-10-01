import type { ReactNode } from "react";
import type { RecoveryAction } from "../../lib/types";

type ResourceOverrideAction = Extract<RecoveryAction, { id: "override-resource" }>;

export function isResourceConflictChooser(
  actions: RecoveryAction[],
): actions is ResourceOverrideAction[] {
  return (
    actions.length > 1 && actions.every((action) => action.id === "override-resource")
  );
}

export function ConflictRecoveryChoices({
  actions,
  onRecoveryAction,
  recoveryBusy = false,
}: {
  actions: RecoveryAction[];
  onRecoveryAction: (action: RecoveryAction) => void;
  recoveryBusy?: boolean;
}): ReactNode {
  if (!isResourceConflictChooser(actions)) {
    return (
      <div className="banner-actions">
        {actions.map((action, index) => (
          <button
            key={`${action.id}-${index}`}
            type="button"
            className={index === 0 ? "btn primary" : "btn"}
            onClick={() => onRecoveryAction(action)}
            disabled={recoveryBusy}
          >
            {action.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="conflict-choice-list" role="list">
      {actions.map((action, index) => (
        <div
          key={`${action.winnerResourceId ?? action.winnerPluginName}-${index}`}
          className="conflict-choice"
          role="listitem"
        >
          <div className="conflict-choice-header">
            <div className="conflict-choice-title">{action.label}</div>
            {action.source ? (
              <div className="conflict-choice-source">{action.source}</div>
            ) : null}
            {action.fingerprint ? (
              <div className="conflict-choice-hash">{action.fingerprint.slice(0, 7)}</div>
            ) : null}
          </div>
          {action.preview ? (
            <pre className="conflict-choice-preview">{action.preview}</pre>
          ) : (
            <p className="muted">No content preview for this copy.</p>
          )}
          <button
            type="button"
            className={index === 0 ? "btn primary" : "btn"}
            onClick={() => onRecoveryAction(action)}
            disabled={recoveryBusy}
          >
            Use this
          </button>
        </div>
      ))}
    </div>
  );
}
