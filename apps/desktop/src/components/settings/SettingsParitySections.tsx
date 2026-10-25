import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { CHOOSE_PROJECT_LABEL } from "../ChooseProjectButton";
import { EmptyState } from "../EmptyState";
import type { TelemetryConsentStatus } from "../../lib/types";
import { CheckForUpdatesSettings } from "./CheckForUpdatesSettings";
import { PluginUpdateSettings } from "./PluginUpdateSettings";
import { ProjectConfigInspect } from "./ProjectConfigInspect";
import { ProjectHarnessOverrideSection } from "./ProjectHarnessOverrideSection";
import { ResolveOrderSettings } from "./ResolveOrderSettings";
import { TelemetrySettingsSection } from "./TelemetrySettingsSection";

export const SETTINGS_NO_PROJECT_TITLE = "Open a project to see its config.";

export type SettingsTab = "project" | "advanced";

export const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: "project", label: "Project" },
  { id: "advanced", label: "Advanced" },
];

export function SettingsParitySections(props: {
  tab: SettingsTab;
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
  const { onProjectDirtyChange } = props;
  const [configDirty, setConfigDirty] = useState(false);
  const [overrideDirty, setOverrideDirty] = useState(false);

  useEffect(() => {
    onProjectDirtyChange?.(configDirty || overrideDirty);
  }, [configDirty, onProjectDirtyChange, overrideDirty]);

  return (
    <>
      <div hidden={props.tab !== "project"}>
        {props.inspectProjectPath ? (
          <>
            <ProjectConfigInspect
          open={props.open}
          baseUrl={props.baseUrl}
          token={props.token}
          projectPath={props.inspectProjectPath}
          disabled={props.disabled}
          onSelectProject={props.onSelectProject}
          onBrowseProject={props.onBrowseProject}
          onDirtyChange={setConfigDirty}
        />
        <ProjectHarnessOverrideSection
          open={props.open}
          baseUrl={props.baseUrl}
          token={props.token}
          projectPath={props.inspectProjectPath}
          disabled={props.disabled}
          onSaved={props.onSaved}
          onDirtyChange={setOverrideDirty}
        />
          </>
        ) : (
          <EmptyState
            testId="settings-project-empty"
            title={SETTINGS_NO_PROJECT_TITLE}
            action={{
              label: CHOOSE_PROJECT_LABEL,
              icon: <FolderOpen size={16} aria-hidden />,
              disabled: props.disabled,
              onClick: props.onBrowseProject,
            }}
          />
        )}
      </div>
      <div hidden={props.tab !== "advanced"}>
        <CheckForUpdatesSettings
          baseUrl={props.baseUrl}
          token={props.token}
          disabled={props.disabled}
        />
        <PluginUpdateSettings
          open={props.open}
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
