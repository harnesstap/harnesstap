import type { GlobalProfileStatus, GlobalProfileStatusDepth } from "./types";

/**
 * Merge a status poll into previous UI state.
 * Fast polls wipe harness/plugin rows on the agent — keep the last full snapshot.
 */
export function mergeStatusUpdate(
  previous: GlobalProfileStatus | null,
  next: GlobalProfileStatus,
  depth: GlobalProfileStatusDepth,
): GlobalProfileStatus {
  if (depth === "full" || previous === null) {
    return next;
  }

  return {
    ...next,
    harnesses: previous.harnesses,
    contents:
      next.contents !== undefined && next.contents !== null
        ? next.contents
        : previous.contents,
    changes:
      Array.isArray(next.changes) && next.changes.length > 0
        ? next.changes
        : (previous.changes ?? next.changes),
  };
}

export function harnessPillState(
  hasFull: boolean,
  missingPlugins: number,
  missingMcp: number,
): "ok" | "issues" | "checking" {
  if (!hasFull) {
    return "checking";
  }
  return missingPlugins === 0 && missingMcp === 0 ? "ok" : "issues";
}
