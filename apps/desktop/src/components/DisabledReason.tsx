import type { ReactElement } from "react";
import { ChromeTooltip } from "./ChromeTooltip";

/**
 * Explains why a primary action is disabled. A disabled button gets no pointer
 * events, so the tooltip sits on a host span around it.
 */
export function DisabledReason({
  reason,
  block = false,
  children,
}: {
  /** Full-width host for buttons that fill their column (e.g. the rail Apply). */
  block?: boolean;
  /** Null or empty when the action is enabled. */
  reason: string | null | undefined;
  children: ReactElement;
}) {
  if (!reason) {
    return children;
  }
  return (
    <ChromeTooltip content={reason}>
      <span
        className={block ? "disabled-reason-host is-block" : "disabled-reason-host"}
        data-disabled-reason={reason}
      >
        {children}
      </span>
    </ChromeTooltip>
  );
}
