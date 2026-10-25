import { useState, type CSSProperties } from "react";
import type { Scope } from "../../lib/api/scope";
import {
  GLOBAL_SCOPE_TOOLTIP,
  PROFILE_SCOPE_SWITCH,
  profileScopeTooltipOffsets,
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

const SWITCH_STYLE = {
  "--profile-scope-global-w": `${PROFILE_SCOPE_SWITCH.globalWidth}px`,
  "--profile-scope-project-w": `${PROFILE_SCOPE_SWITCH.projectWidth}px`,
  "--profile-scope-chevron-w": `${PROFILE_SCOPE_SWITCH.chevronWidth}px`,
  "--profile-scope-gap": `${PROFILE_SCOPE_SWITCH.gap}px`,
  "--profile-scope-pad": `${PROFILE_SCOPE_SWITCH.padding}px`,
  "--profile-scope-border": `${PROFILE_SCOPE_SWITCH.border}px`,
} as CSSProperties;

const TOOLTIP_OFFSETS = profileScopeTooltipOffsets();

/**
 * Profile page header: Global | Project: <name>, with a chevron that opens the
 * project dropdown. With no project set, Project opens the dropdown instead.
 * Both segments have fixed widths, so the switch never resizes.
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
    <div
      className="profile-scope-switch"
      role="group"
      aria-label="Profile scope"
      data-testid="profile-scope-switch"
      style={SWITCH_STYLE}
    >
      <ChromeTooltip content={GLOBAL_SCOPE_TOOLTIP} side="right" sideOffset={TOOLTIP_OFFSETS.global}>
        <button
          type="button"
          className={`profile-scope-option profile-scope-global${projectShown ? "" : " on"}`}
          data-testid="profile-scope-global"
          aria-pressed={!projectShown}
          disabled={disabled}
          onClick={() => onSelectScope("global")}
        >
          Global
        </button>
      </ChromeTooltip>
      <div className={`profile-scope-project${projectShown ? " on" : ""}`}>
        <ChromeTooltip
          content={projectScopeTooltip(projectPath)}
          side="right"
          sideOffset={TOOLTIP_OFFSETS.project}
        >
          <button
            type="button"
            className="profile-scope-option profile-scope-project-option"
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
            <span className="profile-scope-project-label" data-testid="profile-scope-project-label">
              {projectScopeLabel(projectPath)}
            </span>
          </button>
        </ChromeTooltip>
        <ProjectPicker
          variant="chevron"
          chevronLabel={SWITCH_PROJECT_TOOLTIP}
          chevronTooltipSide="right"
          chevronTooltipOffset={TOOLTIP_OFFSETS.chevron}
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
