import { useState } from "react";
import type { Scope } from "../../lib/api/scope";
import {
  GLOBAL_SCOPE_TOOLTIP,
  projectScopeLabel,
  projectScopeTooltip,
  SWITCH_PROJECT_TOOLTIP,
} from "../../lib/profile-scope";
import { ChromeTooltip } from "../ChromeTooltip";
import { ProjectPicker } from "../ProjectPicker";

export interface ProfileScopeSwitchProps {
  scope: Scope;
  projectPath: string;
  disabled?: boolean;
  onSelectScope: (scope: Scope) => void;
  onPickProject: (path: string) => void;
  onBrowseProject: () => void;
}

/**
 * Profile page header: Global | Project: <name>, with a chevron that opens the
 * project dropdown. With no project set, Project opens the dropdown instead.
 */
export function ProfileScopeSwitch({
  scope,
  projectPath,
  disabled = false,
  onSelectScope,
  onPickProject,
  onBrowseProject,
}: ProfileScopeSwitchProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const projectShown = scope === "project" && Boolean(projectPath);

  return (
    <div className="profile-scope-switch" role="group" aria-label="Profile scope">
      <ChromeTooltip content={GLOBAL_SCOPE_TOOLTIP}>
        <button
          type="button"
          className={`profile-scope-option${projectShown ? "" : " on"}`}
          data-testid="profile-scope-global"
          aria-pressed={!projectShown}
          disabled={disabled}
          onClick={() => onSelectScope("global")}
        >
          Global
        </button>
      </ChromeTooltip>
      <div className={`profile-scope-project${projectShown ? " on" : ""}`}>
        <ChromeTooltip content={projectScopeTooltip(projectPath)}>
          <button
            type="button"
            className="profile-scope-option"
            data-testid="profile-scope-project"
            aria-pressed={projectShown}
            disabled={disabled}
            onClick={() => {
              if (projectPath) {
                onSelectScope("project");
              } else {
                setPickerOpen(true);
              }
            }}
          >
            {projectScopeLabel(projectPath)}
          </button>
        </ChromeTooltip>
        <ProjectPicker
          variant="chevron"
          chevronLabel={SWITCH_PROJECT_TOOLTIP}
          projectPath={projectPath}
          disabled={disabled}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={onPickProject}
          onBrowse={onBrowseProject}
        />
      </div>
    </div>
  );
}
