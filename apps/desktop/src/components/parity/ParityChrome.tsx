import { Puzzle } from "lucide-react";
import { ChromeTooltip } from "../ChromeTooltip";

const HEADER_ICON_SIZE = 18;

export type ParityWorkspaceFocus =
  | "library"
  | "discover"
  | "scope"
  | "environments"
  | "harnesses";

export interface ParityChromeProps {
  workspaceFocus: ParityWorkspaceFocus;
  onWorkspaceFocus: (focus: ParityWorkspaceFocus) => void;
  switching?: boolean;
  iconOnly?: boolean;
}

export function ParityChrome({
  workspaceFocus,
  onWorkspaceFocus,
  switching = false,
  iconOnly = false,
}: ParityChromeProps) {
  const button = (
    <button
      type="button"
      className={`header-focus-btn labeled${workspaceFocus === "environments" ? " on" : ""}`}
      onClick={() => onWorkspaceFocus("environments")}
      disabled={switching}
      aria-label="Environments"
      aria-current={workspaceFocus === "environments" ? "page" : undefined}
    >
      <Puzzle size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
      <span className="header-focus-label">Environments</span>
    </button>
  );
  if (!iconOnly) {
    return button;
  }
  return <ChromeTooltip content="Environments">{button}</ChromeTooltip>;
}
