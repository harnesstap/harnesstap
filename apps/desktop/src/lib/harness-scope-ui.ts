import {
  HARNESS_SCOPE_ALL,
  isOrphanedHarnessScope,
  LINKED_SHARED_FOLDER_TOOLTIP,
  linkedHarnessGroups,
  normalizeScopeToRegistered,
  parseHarnessScope,
  expandLinkedSelection,
  selectionFromGroups,
  uniqueSorted,
  unionHarnessScopes,
  type HarnessScope,
  type LinkedHarnessGroup,
} from "../../../../src/services/harness-scope.ts";
import { harnessDisplayName } from "./harness-meta";
import {
  alsoUseOnLabel,
  formatHarnessList,
  nowOnToast,
  portableMcpTooltip,
  SCOPE_COPY,
  subsetScopeLine,
} from "../../../../src/copy/scope";

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
  uniqueSorted,
  unionHarnessScopes,
  formatHarnessList,
};
export type { HarnessScope, LinkedHarnessGroup };

export const HARNESS_SCOPE_COPY = {
  useOn: SCOPE_COPY.useOn,
  selectAll: SCOPE_COPY.selectAll,
  none: SCOPE_COPY.none,
  filterPlaceholder: "Filter harnesses",
  emptyHint: SCOPE_COPY.emptyHint,
  linkedTooltip: SCOPE_COPY.linkedTooltip,
  allTooltip: SCOPE_COPY.allTooltip,
  orphanedTooltip: SCOPE_COPY.orphanedTooltip,
  alsoUseOnLabel,
  notNow: SCOPE_COPY.notNow,
  portableMcpTooltip,
  nowOnToast,
} as const;

/** Registered harnesses a portable MCP is not on yet. Empty when All or non-MCP. */
export function alsoUseOnTargets(
  resourceType: string,
  scope: HarnessScope,
  registered: readonly string[],
): string[] {
  if (resourceType !== "mcp_server") {
    return [];
  }
  if (scope.kind !== "subset") {
    return [];
  }
  const on = new Set(scope.harnesses);
  return registered.filter((id) => !on.has(id));
}

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
  if (ids.length <= 3) {
    return `Only on ${formatHarnessList(ids.map(names))}`;
  }
  return subsetScopeLine(ids);
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

/** Use-on rows, A to Z by name. */
export function sortHarnessOptions<T extends { name: string }>(options: readonly T[]): T[] {
  return [...options].sort((a, b) => a.name.localeCompare(b.name));
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
