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
  tab: Exclude<SettingsTab, "harnesses">;
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  inspectProjectPath: string | null;
  disabled?: boolean;
  onSaved?: () => void;
  onSelectProject: (path: string) => void;
  onBrowseProject: () => void;
}) {
  switch (props.tab) {
    case "project":
      return (
        <ProjectConfigInspect
          open={props.open}
          baseUrl={props.baseUrl}
          token={props.token}
          projectPath={props.inspectProjectPath}
          disabled={props.disabled}
          onSelectProject={props.onSelectProject}
          onBrowseProject={props.onBrowseProject}
        />
      );
    case "advanced":
      return (
        <>
          <TelemetrySettingsSection
            open={props.open}
            baseUrl={props.baseUrl}
            token={props.token}
            disabled={props.disabled}
          />
          <ResolveOrderSettings
            baseUrl={props.baseUrl}
            token={props.token}
            disabled={props.disabled}
            onSaved={props.onSaved}
          />
        </>
      );
    default: {
      const neverTab: never = props.tab;
      return neverTab;
    }
  }
}
