import { useState } from "react";
import { History } from "lucide-react";
import { ProjectHistoryDrawer } from "./ProjectHistoryDrawer";

const HEADER_ICON_SIZE = 18;

export interface ProjectHistoryControlProps {
  baseUrl: string | null;
  token: string | null;
  connected: boolean;
  switching: boolean;
  projectPath: string;
  onSuccess: (message: string) => void;
  onProfilesChanged: () => void;
}

export function ProjectHistoryControl({
  baseUrl,
  token,
  connected,
  switching,
  projectPath,
  onSuccess,
  onProfilesChanged,
}: ProjectHistoryControlProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const chromeDisabled = switching || !connected;

  return (
    <>
      <button
        type="button"
        className="header-focus-btn"
        data-testid="open-project-history"
        onClick={() => setHistoryOpen(true)}
        disabled={chromeDisabled}
        aria-label="History"
        title="History"
      >
        <History size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
      </button>
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
