import { Circle } from "lucide-react";
import {
  libraryInUseKind,
  libraryInUseTooltip,
  type LibraryInUseKind,
  type LibraryInUseMembership,
} from "../lib/library-in-use";
import { ChromeTooltip } from "./ChromeTooltip";

function InUseMarkGlyph({
  kind,
}: {
  kind: Exclude<LibraryInUseKind, "none">;
}) {
  switch (kind) {
    case "project":
      return (
        <Circle
          size={14}
          strokeWidth={1.75}
          fill="none"
          aria-hidden
        />
      );
    case "global":
      return (
        <span
          className="in-use-mark-global w-3.5 h-3.5 rounded-full"
          aria-hidden
        />
      );
    case "both":
      return (
        <span className="in-use-mark-both" aria-hidden>
          <span className="in-use-mark-both-fill" />
        </span>
      );
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}

/** Leading Library membership glyph. Unused renders nothing. */
export function InUseMark({
  membership,
}: {
  membership: LibraryInUseMembership;
}) {
  const kind = libraryInUseKind(membership);
  const tooltip = libraryInUseTooltip(membership);
  if (kind === "none" || !tooltip) {
    return null;
  }
  return (
    <ChromeTooltip content={tooltip}>
      <button
        type="button"
        className="in-use-mark"
        data-testid="library-in-use"
        data-kind={kind}
        aria-label={tooltip}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <InUseMarkGlyph kind={kind} />
      </button>
    </ChromeTooltip>
  );
}
