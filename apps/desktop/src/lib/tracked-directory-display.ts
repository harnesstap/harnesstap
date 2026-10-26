import type { ResourceTrackedDirectoryEntry } from "./types";

type TrackedDirectoryDisplayInput = Pick<
  ResourceTrackedDirectoryEntry,
  "kind" | "path" | "display_path"
>;

/**
 * Kind badge beside a tracked directory title. Home defaults already say so in
 * their title ("Home harness defaults"), so only custom entries get a badge.
 */
export function trackedDirectoryKindBadge(entry: TrackedDirectoryDisplayInput): string | null {
  return entry.kind === "custom" ? "Custom" : null;
}

/** Path line under the title, or null when it would only show the bare home ("~"). */
export function trackedDirectoryPathLine(entry: TrackedDirectoryDisplayInput): string | null {
  const shown = (entry.display_path ?? entry.path).trim();
  return shown === "" || shown === "~" || shown === "~/" ? null : shown;
}
