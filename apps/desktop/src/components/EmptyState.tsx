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
}: EmptyStateProps) {
  const classes = ["empty-state", className].filter(Boolean).join(" ");
  return (
    <div className={classes} role="status" data-testid={testId}>
      {icon ? <div className="empty-state-icon">{icon}</div> : null}
      <h2>{title}</h2>
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
