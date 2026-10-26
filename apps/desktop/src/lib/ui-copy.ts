/**
 * Central Desktop user-facing strings (DS-1, DS-6).
 * ASCII punctuation only. No em dashes, en dashes, or Unicode ellipsis.
 */

import { getDisplayHome } from "./display-home";

export const EMPTY_PROFILE_COPY = {
  title: "This profile is empty.",
  body: "Add resources from Library.",
} as const;

export const MARKETPLACE_URL_INVALID =
  "Enter a URL like https://github.com/org/repo or a folder path.";

export const DETECT_HARNESSES_COMMAND = "Detect harnesses";
export const SYNC_HARNESSES_COMMAND = "Sync harnesses";
export const HARNESSES_EMPTY_TITLE = "No harnesses yet";
export const HARNESSES_EMPTY_BODY = "Detect the agents on this machine, or add one by hand.";

export const HARNESS_NOT_SET_UP_COPY = {
  title: "Not set up for any harness yet.",
  body: "Run ht harness set, or pass --harness <slugs>.",
  action: "Set up harness",
} as const;

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
  kept: "Kept",
  keptChanged: "Kept. You changed it.",
  keptUnmanaged: "Kept. Not made by HarnessTap.",
} as const;

export const REMOVAL_GROUP_COPY = {
  owned_unmodified: PREVIEW_FILE_COPY.willRemove,
  owned_modified: PREVIEW_FILE_COPY.keptChanged,
  unmanaged: PREVIEW_FILE_COPY.keptUnmanaged,
} as const;

export const REMOVAL_CONFIRM_COPY = {
  title(kept: number): string {
    return kept === 1 ? "1 file will be kept" : `${kept} files will be kept`;
  },
  description:
    "You changed these files, or HarnessTap did not make them. Apply keeps them unless you remove them anyway.",
  applyAndKeep: "Apply and keep",
  removeAnyway: "Remove anyway",
  cancel: "Cancel",
  modifiedHeading: PREVIEW_FILE_COPY.keptChanged,
  unmanagedHeading: PREVIEW_FILE_COPY.keptUnmanaged,
} as const;

function fileCount(n: number): string {
  return n === 1 ? "1 file" : `${n} files`;
}

export const APPLY_RESULT_COPY = {
  viewSnapshot: "View snapshot",
  close: "Close",
  wroteRemovedKept(wrote: number, removed: number, kept: number): string {
    const parts = [
      wrote > 0 ? `wrote ${fileCount(wrote)}` : null,
      removed > 0 ? `removed ${fileCount(removed)}` : null,
      kept > 0 ? `kept ${kept}` : null,
    ].filter((part): part is string => part !== null);
    if (parts.length === 0) {
      return "Applied.";
    }
    const sentence = parts.join(", ");
    return `Applied. ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
  },
  everythingUpToDate(unchanged: number): string {
    return `Everything is up to date. ${unchanged} unchanged.`;
  },
  takenLine(relative: string): string {
    return `Taken ${relative}`;
  },
  undoWith(snapshotId: string): string {
    return `Undo with ht revert ${snapshotId}`;
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

/** Connect splash (DT-6). ASCII punctuation only. Never says sidecar. */
export const CONNECT_SPLASH_COPY = {
  starting: "Starting the agent",
  couldNotConnect: "Can't reach the HarnessTap agent. It may still be starting.",
  sidecarConnectionFailed: "Can't reach the HarnessTap agent. It may still be starting.",
  unreachable: "Can't reach the HarnessTap agent. It may still be starting.",
  reconnecting: "Reconnecting to the HarnessTap agent...",
  unexpectedStop: "The HarnessTap agent stopped unexpectedly.",
  retry: "Retry",
  openLogs: "Open logs",
  openLogsFailed(reason: string): string {
    return reason
      ? `Could not open the logs folder: ${reason}`
      : "Could not open the logs folder.";
  },
  detailsSummary: "Show details",
  detailsEmptyOutput: "The agent exited without printing anything.",
  detailsExit(exit: string): string {
    return `Agent exit: ${exit}`;
  },
  detailsLogFile(path: string): string {
    return `Log file: ${path}`;
  },
} as const;

export const AGENT_START_COPY = {
  newerSchema:
    "This data was saved by a newer HarnessTap. Update the app to open it.",
  portInUse:
    "Port 7474 is already in use. Close the other HarnessTap process and try again.",
  homeNotWritable:
    "HarnessTap can't write to its data folder. Check folder permissions and try again.",
} as const;

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

export const CREATE_RESOURCE_COPY = {
  subagentTitle: "Subagent",
  subagentDescription: "A subagent definition with optional model settings.",
} as const;

const USER_PATH_MAX = 48;

/** Show `$HOME` as `~`. ASCII `...` when the path is too long (DT-15). */
export function formatUserPath(path: string, home?: string): string {
  const resolved =
    home
    ?? getDisplayHome()
    ?? (typeof process !== "undefined" ? process.env.HOME ?? process.env.USERPROFILE : undefined);
  const normalized = path.replaceAll("\\", "/");
  const homeNorm = resolved?.replaceAll("\\", "/");
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

/** One error state for a list that failed to load (replaces its empty state). */
export function loadErrorCopy(noun: string) {
  return {
    title: `Couldn't load ${noun}`,
    body: "Check that the HarnessTap agent is running, then try again.",
    action: "Retry",
  } as const;
}

export const ENVIRONMENTS_EMPTY_COPY = {
  title: "No environments yet",
  body: "Use one to share env vars, secrets, models, and permissions across profiles.",
  action: "Create environment",
} as const;
