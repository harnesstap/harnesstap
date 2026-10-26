import type { ReactNode } from "react";
import { RefreshCw, X } from "lucide-react";
import { IconActionButton } from "../IconActionButton";

export type BannerTone = "error" | "warning" | "info" | "neutral";

export interface BannerProps {
  tone: BannerTone;
  message: ReactNode;
  onRetry?: () => void;
  retryBusy?: boolean;
  retryLabel?: string;
  /** Show the retry label next to its icon (for actions that are not a plain Retry). */
  retryShowLabel?: boolean;
  retryBusyLabel?: string;
  onDismiss?: () => void;
  /** Extra actions rendered before Retry / Dismiss. */
  children?: ReactNode;
  className?: string;
  role?: "alert" | "status";
  testId?: string;
}

/** Inline status banner with one consistent action cluster (Retry, then Dismiss). */
export function Banner({
  tone,
  message,
  onRetry,
  retryBusy = false,
  retryLabel = "Retry",
  retryShowLabel = false,
  retryBusyLabel = "Retrying...",
  onDismiss,
  children,
  className,
  role,
  testId,
}: BannerProps) {
  const toneClass = tone === "warning" ? "" : tone;
  const hasActions = Boolean(onRetry || onDismiss || children);
  return (
    <div
      className={["banner", toneClass, className].filter(Boolean).join(" ")}
      role={role ?? (tone === "error" ? "alert" : undefined)}
      data-testid={testId}
    >
      <div>{message}</div>
      {hasActions ? (
        <div className="banner-actions">
          {children}
          {onRetry ? (
            <IconActionButton
              label={retryBusy ? retryBusyLabel : retryLabel}
              showLabel={retryShowLabel}
              busy={retryBusy}
              onClick={onRetry}
              icon={<RefreshCw size={16} strokeWidth={2} aria-hidden="true" />}
            />
          ) : null}
          {onDismiss ? (
            <IconActionButton
              label="Dismiss"
              onClick={onDismiss}
              icon={<X size={16} strokeWidth={2} aria-hidden="true" />}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
