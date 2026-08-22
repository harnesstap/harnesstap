import { Puzzle } from "lucide-react";

const HEADER_ICON_SIZE = 18;

export type ParityWorkspaceFocus = "library" | "sources" | "scope" | "environments";

export interface ParityChromeProps {
  workspaceFocus: ParityWorkspaceFocus;
  onWorkspaceFocus: (focus: ParityWorkspaceFocus) => void;
  switching?: boolean;
}

export function ParityChrome({
  workspaceFocus,
  onWorkspaceFocus,
  switching = false,
}: ParityChromeProps) {
  return (
    <button
      type="button"
      className={`header-focus-btn labeled${workspaceFocus === "environments" ? " on" : ""}`}
      onClick={() => onWorkspaceFocus("environments")}
      disabled={switching}
      aria-label="Environments"
      title="Environments"
    >
      <Puzzle size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
      Environments
    </button>
  );
}
