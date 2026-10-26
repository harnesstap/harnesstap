import type { ReactNode } from "react";
import { IconActionButton } from "./IconActionButton";

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  icon: ReactNode;
}

export interface EmptyStateProps {
  title: string;
  body?: ReactNode;
  icon?: ReactNode;
  action?: EmptyStateAction;
  children?: ReactNode;
  className?: string;
  testId?: string;
  /** A filter miss: fixed offset under the filter, and the quoted query never breaks mid-word. */
  variant?: "no-match";
}

/** Keeps a trailing `"query"` on one line so it wraps as a whole word. */
function renderTitle(title: string, noMatch: boolean): ReactNode {
  const quoteAt = noMatch ? title.indexOf('"') : -1;
  if (quoteAt <= 0 || !title.endsWith('"')) {
    return title;
  }
  return (
    <>
      {title.slice(0, quoteAt)}
      <span className="empty-state-query">{title.slice(quoteAt)}</span>
    </>
  );
}

/** Shared empty / miss recipe: heading, why, one action. */
export function EmptyState({
  title,
  body,
  icon,
  action,
  children,
  className,
  testId,
  variant,
}: EmptyStateProps) {
  const noMatch = variant === "no-match";
  const classes = ["empty-state", noMatch ? "empty-state-no-match" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} role="status" data-testid={testId}>
      {icon ? <div className="empty-state-icon">{icon}</div> : null}
      <h2>{renderTitle(title, noMatch)}</h2>
      {body ? <p className="muted">{body}</p> : null}
      {action || children ? (
        <div className="empty-state-actions">
          {action ? (
            <IconActionButton
              label={action.label}
              icon={action.icon}
              primary={action.primary}
              showLabel
              disabled={action.disabled}
              onClick={action.onClick}
            />
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
