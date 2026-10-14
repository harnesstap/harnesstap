import type { ReactElement } from "react";
import { ChromeTooltip } from "../ChromeTooltip";
import type { ProfileHeaderStatusKind } from "../../lib/reapply";
import { statusRefreshingTooltip } from "../../lib/status-refresh";

function ProfileHeaderStatusGlyph({
  kind,
}: {
  kind: Exclude<ProfileHeaderStatusKind, "none">;
}) {
  switch (kind) {
    case "inactive":
    case "active_applied":
      return <span className="profile-header-status-dot m-status" aria-hidden />;
    case "active_not_fully_applied":
      return (
        <>
          <span className="profile-header-status-dot m-status" aria-hidden />
          <span className="profile-header-status-warn m-status" aria-hidden />
        </>
      );
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}

/** Apply-status disc with tooltip (header button, or rail span inside the row). */
export function ProfileHeaderStatus({
  kind,
  tooltip,
  refreshing = false,
  as = "button",
  testId = "profile-header-status",
}: {
  kind: Exclude<ProfileHeaderStatusKind, "none">;
  tooltip: string;
  refreshing?: boolean;
  as?: "button" | "span";
  testId?: string;
}) {
  const label = statusRefreshingTooltip(tooltip, refreshing);
  const glyph = <ProfileHeaderStatusGlyph kind={kind} />;
  const discProps = {
    className: "profile-header-status",
    "data-testid": testId,
    "data-kind": kind,
    "data-refreshing": refreshing ? "true" : undefined,
    "aria-label": label,
  } as const;
  let trigger: ReactElement;
  switch (as) {
    case "span":
      trigger = <span {...discProps}>{glyph}</span>;
      break;
    case "button":
      trigger = (
        <button type="button" {...discProps}>
          {glyph}
        </button>
      );
      break;
    default: {
      const neverAs: never = as;
      trigger = neverAs;
    }
  }
  return <ChromeTooltip content={label}>{trigger}</ChromeTooltip>;
}
