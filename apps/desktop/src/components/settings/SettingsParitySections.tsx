import type { TelemetryConsentStatus } from "../../lib/types";
import { CheckForUpdatesSettings } from "./CheckForUpdatesSettings";
import { ProjectConfigInspect } from "./ProjectConfigInspect";
import { ResolveOrderSettings } from "./ResolveOrderSettings";
import { TelemetrySettingsSection } from "./TelemetrySettingsSection";

export type SettingsTab = "harnesses" | "project" | "advanced";

export const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: "harnesses", label: "Harnesses" },
  { id: "project", label: "Project" },
  { id: "advanced", label: "Advanced" },
];

export function SettingsParitySections(props: {
  tab: Exclude<SettingsTab, "harnesses"> | SettingsTab;
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  inspectProjectPath: string | null;
  disabled?: boolean;
  onSaved?: () => void;
  onSelectProject: (path: string) => void;
  onBrowseProject: () => void;
  onProjectDirtyChange?: (dirty: boolean) => void;
  onTelemetryConsentChange?: (next: TelemetryConsentStatus) => void;
}) {
  return (
    <>
      <div hidden={props.tab !== "project"}>
        <ProjectConfigInspect
          open={props.open}
          baseUrl={props.baseUrl}
          token={props.token}
          projectPath={props.inspectProjectPath}
          disabled={props.disabled}
          onSelectProject={props.onSelectProject}
          onBrowseProject={props.onBrowseProject}
          onDirtyChange={props.onProjectDirtyChange}
        />
      </div>
      <div hidden={props.tab !== "advanced"}>
        <CheckForUpdatesSettings
          baseUrl={props.baseUrl}
          token={props.token}
          disabled={props.disabled}
        />
        <TelemetrySettingsSection
          open={props.open}
          baseUrl={props.baseUrl}
          token={props.token}
          disabled={props.disabled}
          onConsentChange={props.onTelemetryConsentChange}
        />
        <ResolveOrderSettings
          baseUrl={props.baseUrl}
          token={props.token}
          disabled={props.disabled}
        />
      </div>
    </>
  );
}
