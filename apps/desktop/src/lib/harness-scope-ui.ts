import {
  HARNESS_SCOPE_ALL,
  isOrphanedHarnessScope,
  LINKED_SHARED_FOLDER_TOOLTIP,
  linkedHarnessGroups,
  normalizeScopeToRegistered,
  parseHarnessScope,
  expandLinkedSelection,
  selectionFromGroups,
  type HarnessScope,
  type LinkedHarnessGroup,
} from "../../../../src/services/harness-scope.ts";
import { harnessDisplayName } from "./harness-meta";

export type SerializerTarget = "project" | "global";

export {
  HARNESS_SCOPE_ALL,
  isOrphanedHarnessScope,
  LINKED_SHARED_FOLDER_TOOLTIP,
  linkedHarnessGroups,
  normalizeScopeToRegistered,
  parseHarnessScope,
  expandLinkedSelection,
  selectionFromGroups,
};
export type { HarnessScope, LinkedHarnessGroup };

export const HARNESS_SCOPE_COPY = {
  useOn: "Use on",
  selectAll: "Select all",
  none: "None",
  main: "Main",
  filterPlaceholder: "Filter harnesses",
  emptyHint: "Pick at least one harness",
  linkedTooltip: LINKED_SHARED_FOLDER_TOOLTIP,
  allTooltip: "On all harnesses. Pick which ones",
  orphanedTooltip: "Its harnesses are gone. Pick new ones",
} as const;

export interface HarnessScopeOption {
  id: string;
  name: string;
}

export function parseStoredHarnessScope(raw: "all" | string[] | undefined): HarnessScope {
  return parseHarnessScope(raw);
}

export function harnessScopeAriaLabel(resourceName: string): string {
  return `Harnesses for ${resourceName}`;
}

export function subsetScopeTooltip(ids: readonly string[], names: (id: string) => string): string {
  const visible = ids.slice(0, 3).map(names);
  const extra = ids.length - visible.length;
  if (extra <= 0) {
    return `Only on ${visible.join(", ")}`;
  }
  return `Only on ${visible.join(", ")} and ${extra} more`;
}

export function harnessScopeTooltip(
  scope: HarnessScope,
  registered: readonly string[],
  names: (id: string) => string,
): string {
  if (isOrphanedHarnessScope(scope, registered)) {
    return HARNESS_SCOPE_COPY.orphanedTooltip;
  }
  if (scope.kind === "all") {
    return HARNESS_SCOPE_COPY.allTooltip;
  }
  return subsetScopeTooltip(scope.harnesses, names);
}

export function sortHarnessOptions(
  options: readonly HarnessScopeOption[],
  mainId: string | undefined,
): HarnessScopeOption[] {
  const rest = options
    .filter((option) => option.id !== mainId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const main = mainId ? options.find((option) => option.id === mainId) : undefined;
  return main ? [main, ...rest] : rest;
}

export function groupLabel(ids: readonly string[], names: (id: string) => string): string {
  return ids.map(names).join(" + ");
}

export function displayNameForHarness(id: string, catalogName?: string): string {
  return catalogName ?? harnessDisplayName(id);
}

export function scopeTarget(view: "home" | "project"): SerializerTarget {
  return view === "project" ? "project" : "global";
}
