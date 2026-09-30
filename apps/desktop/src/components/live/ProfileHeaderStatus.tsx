import { ChromeTooltip } from "../ChromeTooltip";
import type { ProfileHeaderStatusKind } from "../../lib/reapply";

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

/** Leading live-toolbar apply-status disc with tooltip. */
export function ProfileHeaderStatus({
  kind,
  tooltip,
}: {
  kind: Exclude<ProfileHeaderStatusKind, "none">;
  tooltip: string;
}) {
  return (
    <ChromeTooltip content={tooltip}>
      <button
        type="button"
        className="profile-header-status"
        data-testid="profile-header-status"
        data-kind={kind}
        aria-label={tooltip}
      >
        <ProfileHeaderStatusGlyph kind={kind} />
      </button>
    </ChromeTooltip>
  );
}
