import { useState } from "react";
import { Boxes, History, Plug, Puzzle } from "lucide-react";
import { ApplyPluginDrawer } from "./ApplyPluginDrawer";
import { ProjectHistoryDrawer } from "./ProjectHistoryDrawer";

const HEADER_ICON_SIZE = 18;

export type ParityWorkspaceFocus = "resources" | "scope" | "environments" | "plugins";

export interface ParityChromeProps {
  baseUrl: string | null;
  token: string | null;
  connected: boolean;
  switching: boolean;
  projectPath: string | null;
  selectedProfile: string | null;
  workspaceFocus: ParityWorkspaceFocus;
  onWorkspaceFocus: (focus: ParityWorkspaceFocus) => void;
  onSuccess: (message: string) => void;
  onProfilesChanged: () => void;
  onBusyChange?: (busy: boolean) => void;
}

export function ParityChrome({
  baseUrl,
  token,
  connected,
  switching,
  projectPath,
  workspaceFocus,
  onWorkspaceFocus,
  onSuccess,
  onProfilesChanged,
  onBusyChange,
}: ParityChromeProps) {
  const [applyOpen, setApplyOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const chromeDisabled = switching || !connected;

  return (
    <>
      <button
        type="button"
        className={`header-focus-btn${workspaceFocus === "environments" ? " on" : ""}`}
        onClick={() => onWorkspaceFocus("environments")}
        disabled={switching}
        aria-label="Environments"
        title="Environments"
      >
        <Puzzle size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`header-focus-btn${workspaceFocus === "plugins" ? " on" : ""}`}
        onClick={() => onWorkspaceFocus("plugins")}
        disabled={switching}
        aria-label="Plugins"
        title="Plugins"
      >
        <Boxes size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="header-focus-btn"
        onClick={() => setApplyOpen(true)}
        disabled={chromeDisabled || !token}
        aria-label="Apply plugin"
        title="Apply plugin…"
      >
        <Plug size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="header-focus-btn"
        data-testid="open-project-history"
        onClick={() => setHistoryOpen(true)}
        disabled={chromeDisabled || !projectPath}
        aria-label="History"
        title={projectPath ? "History" : "Choose a project to view history"}
      >
        <History size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
      </button>
      <ApplyPluginDrawer
        open={applyOpen}
        baseUrl={baseUrl}
        token={token}
        connected={connected}
        switching={switching}
        projectPath={projectPath}
        disabled={chromeDisabled}
        onClose={() => setApplyOpen(false)}
        onSuccess={onSuccess}
        onProfilesChanged={onProfilesChanged}
        onBusyChange={onBusyChange}
      />
      <ProjectHistoryDrawer
        open={historyOpen}
        baseUrl={baseUrl}
        token={token}
        connected={connected}
        switching={switching}
        projectPath={projectPath}
        disabled={chromeDisabled}
        onClose={() => setHistoryOpen(false)}
        onSuccess={onSuccess}
        onProfilesChanged={onProfilesChanged}
      />
    </>
  );
}
