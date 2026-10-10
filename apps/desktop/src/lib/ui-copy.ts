/**
 * Central Desktop user-facing strings (DS-1, DS-6).
 * ASCII punctuation only. No em dashes, en dashes, or Unicode ellipsis.
 */

export const HARNESS_MAIN_PILL_TOOLTIP =
  "Your main harness. It wins when harnesses disagree.";

export const CONFLICT_POLICY_COPY = {
  replace: "Replace the existing one",
  skip: "Keep the existing one and move on",
  prompt: "Ask each time",
  cancel: "Stop without changing anything",
} as const;

export const SWITCH_CHANGES_COPY = {
  save: "Save them",
  stash: "Stash them",
  discard: "Discard them",
  cancel: "Cancel",
} as const;

export const PREVIEW_FILE_COPY = {
  willWrite: "Will write",
  upToDate: "Up to date",
  notInProfile: "Not in profile",
  willRemove: "Will remove",
  keptChanged: "Kept. You changed it.",
  keptUnmanaged: "Kept. Not made by HarnessTap.",
} as const;

export const REMOVAL_GROUP_COPY = {
  owned_unmodified: PREVIEW_FILE_COPY.willRemove,
  owned_modified: PREVIEW_FILE_COPY.keptChanged,
  unmanaged: PREVIEW_FILE_COPY.keptUnmanaged,
} as const;

export const REMOVAL_CONFIRM_COPY = {
  title: "Some files will not be removed",
  description:
    "These files were changed by you or were not made by HarnessTap. Apply will keep them unless you choose to remove them too.",
  keepTheseFiles: "Keep these files",
  removeThemToo: "Remove them too",
  cancel: "Cancel",
  modifiedHeading: PREVIEW_FILE_COPY.keptChanged,
  unmanagedHeading: PREVIEW_FILE_COPY.keptUnmanaged,
} as const;

export const APPLY_RESULT_COPY = {
  viewSnapshot: "View snapshot",
  wroteRemovedKept(wrote: number, removed: number, kept: number): string {
    return `Wrote ${wrote}, removed ${removed}, kept ${kept}`;
  },
  everythingUpToDate(unchanged: number): string {
    return `Everything is up to date. ${unchanged} unchanged.`;
  },
};

export const OWNED_REPLACE_COPY = {
  title: "Replace owned profile paths?",
  description:
    "HarnessTap detected hand-edits inside paths owned by the last apply snapshot. Continuing will replace those owned keys.",
  applyAnyway: "Apply anyway",
  reapplyAnyway: "Re-apply anyway",
} as const;

export type PlannedRemovalGroup = "owned_unmodified" | "owned_modified" | "unmanaged";

export interface PlannedRemovals {
  owned_unmodified: string[];
  owned_modified: string[];
  unmanaged: string[];
}

export function emptyPlannedRemovals(): PlannedRemovals {
  return { owned_unmodified: [], owned_modified: [], unmanaged: [] };
}

export function riskyRemovalPaths(groups: PlannedRemovals | undefined): string[] {
  if (!groups) {
    return [];
  }
  return [...groups.owned_modified, ...groups.unmanaged];
}

export function applyResultToastTitle(input: {
  wrote: number;
  removed: number;
  kept: number;
  unchanged?: number;
}): string {
  if (input.wrote === 0 && input.removed === 0 && input.kept === 0) {
    return APPLY_RESULT_COPY.everythingUpToDate(input.unchanged ?? 0);
  }
  return APPLY_RESULT_COPY.wroteRemovedKept(input.wrote, input.removed, input.kept);
}

/** Surfaces that show zero-count type pills (DT-19). Never hide those pills. */
export type TypeTabEmptySurface = "library" | "profile" | "project";

export function emptyTypeTabTooltip(
  unitPlural: string,
  surface: TypeTabEmptySurface,
): string {
  switch (surface) {
    case "library":
      return `No ${unitPlural} in your library yet`;
    case "profile":
      return `No ${unitPlural} in this profile yet`;
    case "project":
      return `No ${unitPlural} in this project yet`;
    default: {
      const neverSurface: never = surface;
      return neverSurface;
    }
  }
}

/** Title-case type line on hover cards (DT-15). */
export function hoverTypeLabel(type: string): string {
  switch (type) {
    case "skill":
      return "Skill";
    case "agent":
      return "Subagent";
    case "command":
      return "Command";
    case "hook":
      return "Hook";
    case "instruction":
      return "Instruction";
    case "mcp_server":
      return "MCP server";
    case "plugin":
    case "plugin_ref":
    case "plugin_pin":
      return "Plugin";
    case "rule":
      return "Rule";
    case "permission":
      return "Permission";
    case "env_var":
      return "Env var";
    case "model_config":
      return "Model config";
    default:
      return type.replaceAll("_", " ");
  }
}

export const CONNECT_SPLASH_COPY = {
  starting: "Starting the agent",
  unreachable: "Can't reach the HarnessTap agent",
  retry: "Retry",
  openLogs: "Open logs",
} as const;

export const CREATE_RESOURCE_COPY = {
  subagentTitle: "Subagent",
  subagentDescription: "A subagent definition with optional model settings.",
} as const;

const USER_PATH_MAX = 48;

/** Show `$HOME` as `~`. ASCII `...` when the path is too long (DT-15). */
export function formatUserPath(
  path: string,
  home = typeof process !== "undefined" ? process.env.HOME ?? process.env.USERPROFILE : undefined,
): string {
  const normalized = path.replaceAll("\\", "/");
  const homeNorm = home?.replaceAll("\\", "/");
  const tilde =
    homeNorm && (normalized === homeNorm || normalized.startsWith(`${homeNorm}/`))
      ? `~${normalized.slice(homeNorm.length)}`
      : normalized;
  if (tilde.length <= USER_PATH_MAX) {
    return tilde;
  }
  const keep = Math.floor((USER_PATH_MAX - 3) / 2);
  return `${tilde.slice(0, keep)}...${tilde.slice(-keep)}`;
}
