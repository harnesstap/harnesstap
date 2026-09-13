import { IconActionButton } from "./IconActionButton";
import {
  libraryInUseKind,
  libraryInUseTooltip,
  type LibraryInUseMembership,
} from "../lib/library-in-use";

export function LibraryInUseMark({
  membership,
}: {
  membership: LibraryInUseMembership;
}) {
  const kind = libraryInUseKind(membership);
  if (kind === "none") {
    return null;
  }
  const tooltip = libraryInUseTooltip(membership);
  if (!tooltip) {
    return null;
  }
  return (
    <IconActionButton
      className="library-in-use-action"
      data-testid="library-in-use"
      data-kind={kind}
      label={tooltip}
      title={tooltip}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      icon={
        <span className="library-in-use-mark" data-kind={kind} aria-hidden />
      }
    />
  );
}
