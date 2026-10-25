import type { Scope } from "./api/scope";
import { loadRecentProjects, projectDisplayName } from "./recent-projects";

const STORAGE_KEY = "harnesstap.desktop.profileScope";

export const PROFILE_TAB_TOOLTIP = "Your Global and Project profiles";
export const GLOBAL_SCOPE_TOOLTIP = "Global profile. Used in every project.";
export const SWITCH_PROJECT_TOOLTIP = "Switch project";

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
