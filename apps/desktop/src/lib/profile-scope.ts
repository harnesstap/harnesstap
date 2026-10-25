import type { Scope } from "./api/scope";
import { loadRecentProjects, projectDisplayName } from "./recent-projects";

const STORAGE_KEY = "harnesstap.desktop.profileScope";

export const PROFILE_TAB_TOOLTIP = "Your Global and Project profiles";
export const GLOBAL_SCOPE_TOOLTIP = "Global profile. Used in every project.";
export const SWITCH_PROJECT_TOOLTIP = "Switch project";

/**
 * Fixed geometry of the Profile scope switch, in px. Both segments keep these
 * widths in every state (Global, Project, long name, no project, dropdown
 * open), so selecting never moves the switch or the page header. A project
 * name that does not fit is cut with an ellipsis; the tooltip has it in full.
 */
export const PROFILE_SCOPE_SWITCH = {
  globalWidth: 64,
  /** Project label plus its chevron. */
  projectWidth: 240,
  chevronWidth: 26,
  gap: 2,
  padding: 2,
  border: 1,
} as const;

/** Outer width of the switch: border, padding, both segments and the gap. */
export const PROFILE_SCOPE_SWITCH_WIDTH =
  2 * (PROFILE_SCOPE_SWITCH.border + PROFILE_SCOPE_SWITCH.padding) +
  PROFILE_SCOPE_SWITCH.globalWidth +
  PROFILE_SCOPE_SWITCH.gap +
  PROFILE_SCOPE_SWITCH.projectWidth;

/** Gap in px between the switch's right edge and its tooltips. */
const TOOLTIP_GAP = 8;

/**
 * Switch tooltips open to the right of the whole switch, on the same row, so
 * they never cover the profile title under it. Each value is the Radix
 * `sideOffset` that carries a segment's tooltip past the switch's right edge.
 */
export function profileScopeTooltipOffsets(): {
  global: number;
  project: number;
  chevron: number;
} {
  const { projectWidth, chevronWidth, gap, padding, border } = PROFILE_SCOPE_SWITCH;
  const edge = padding + border + TOOLTIP_GAP;
  return {
    chevron: edge,
    project: chevronWidth + edge,
    global: gap + projectWidth + edge,
  };
}

export function projectScopeTooltip(projectPath: string): string {
  return projectPath
    ? `Project profile for ${projectDisplayName(projectPath)}`
    : "Pick a project";
}

export function projectScopeLabel(projectPath: string): string {
  return projectPath ? `Project: ${projectDisplayName(projectPath)}` : "Project";
}

/**
 * Last scope picked on the Profile tab. First run is Global; a remembered
 * Project with no project to open falls back to Global.
 */
export function loadProfileScope(): Scope {
  try {
    if (localStorage.getItem(STORAGE_KEY) === "project" && loadRecentProjects().length > 0) {
      return "project";
    }
  } catch {
    // Storage unavailable: first-run default.
  }
  return "global";
}

export function saveProfileScope(scope: Scope): void {
  try {
    localStorage.setItem(STORAGE_KEY, scope);
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}
