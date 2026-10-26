import { ProjectHistoryDrawer } from "./ProjectHistoryDrawer";

export interface ProjectHistoryControlProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseUrl: string | null;
  token: string | null;
  connected: boolean;
  switching: boolean;
  projectPath: string;
  onSuccess: (message: string) => void;
  onProfilesChanged: () => void;
}

/** Project history drawer. Opened from the profile header 3-dot menu ("Project history"). */
export function ProjectHistoryControl({
  open,
  onOpenChange,
  baseUrl,
  token,
  connected,
  switching,
  projectPath,
  onSuccess,
  onProfilesChanged,
}: ProjectHistoryControlProps) {
  return (
    <ProjectHistoryDrawer
      open={open}
      baseUrl={baseUrl}
      token={token}
      connected={connected}
      switching={switching}
      projectPath={projectPath}
      disabled={switching || !connected}
      onClose={() => onOpenChange(false)}
      onSuccess={onSuccess}
      onProfilesChanged={onProfilesChanged}
    />
  );
}
