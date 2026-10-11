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
import { HARNESS_MAIN_PILL_TOOLTIP } from "./ui-copy";

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
};
export type { HarnessScope, LinkedHarnessGroup };

export const HARNESS_SCOPE_COPY = {
  useOn: SCOPE_COPY.useOn,
  selectAll: SCOPE_COPY.selectAll,
  none: SCOPE_COPY.none,
  main: SCOPE_COPY.main,
  mainTooltip: HARNESS_MAIN_PILL_TOOLTIP,
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
