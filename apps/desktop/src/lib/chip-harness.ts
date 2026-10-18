import {
  alsoUseOnTargets,
  expandLinkedSelection,
  formatHarnessList,
  parseStoredHarnessScope,
} from "./harness-scope-ui";
import { resourceTypeTabUnit } from "./resource-type-tabs";

type Names = (id: string) => string;

export interface ChipHarnessLabel {
  /** "Only in Cursor and Codex": the pill's tooltip and accessible description. */
  full: string;
  /** Harnesses the resource is in that are not turned on. */
  offIds: string[];
}

/**
 * Which tools a resource pill is in, for its tooltip. Nothing when the
 * resource is on every harness turned on for the profile; otherwise it names
 * where the resource IS, never what it is missing.
 */
export function chipHarnessLabel(
  stored: "all" | string[] | undefined,
  registered: readonly string[],
  names: Names,
): ChipHarnessLabel | null {
  const split = splitScope(stored, registered);
  if (!split) {
    return null;
  }
  const { on, offIds } = split;
  if (on.length > 0) {
    // Tools that are not turned on are left out: nothing is written there.
    return { full: `Only in ${formatHarnessList(on.map(names))}`, offIds: [] };
  }
  const shown = offIds.slice(0, 3).map(names);
  const more = offIds.length - shown.length;
  const list = more > 0 ? `${shown.join(", ")} and ${more} more` : formatHarnessList(shown);
  const verb = offIds.length === 1 ? "is" : "are";
  return {
    full: `Only in ${list}. ${offIds.length === 1 ? list : "They"} ${verb} not turned on, so nothing is written there`,
    offIds,
  };
}

/**
 * A subset scope split into the harnesses turned on for the profile and the
 * ones that are not. Null when the resource is on every harness turned on.
 */
function splitScope(
  stored: "all" | string[] | undefined,
  registered: readonly string[],
): { on: string[]; offIds: string[] } | null {
  const scope = parseStoredHarnessScope(stored);
  if (scope.kind === "all") {
    return null;
  }
  const ids = [...new Set(scope.harnesses)];
  if (ids.length === 0) {
    return null;
  }
  const on = registered.filter((id) => ids.includes(id));
  if (registered.length > 0 && on.length === registered.length) {
    return null;
  }
  return { on, offIds: ids.filter((id) => !registered.includes(id)) };
}

export type ChipHarnessHint =
  | { kind: "icon"; harnessId: string }
  | { kind: "count"; count: number };

/**
 * The small circle at the end of a resource pill. One harness: that
 * harness's mark. Two or more but not all: how many. On every harness
 * turned on for the profile: nothing.
 */
export function chipHarnessHint(
  stored: "all" | string[] | undefined,
  registered: readonly string[],
): ChipHarnessHint | null {
  const split = splitScope(stored, registered);
  if (!split) {
    return null;
  }
  // Count the tools it really runs in; fall back to the ones not turned on
  // only when it is in none of the enabled ones.
  const ids = split.on.length > 0 ? split.on : split.offIds;
  if (ids.length === 1) {
    return { kind: "icon", harnessId: ids[0] ?? "" };
  }
  return { kind: "count", count: ids.length };
}

/**
 * Tools popover: the harnesses left after unchecking a group, or null when
 * that would leave the resource in no tool at all. A harness that is not
 * turned on still counts while it is checked.
 */
export function uncheckHarnessGroup(
  draft: readonly string[],
  groupIds: readonly string[],
): string[] | null {
  const next = expandLinkedSelection([...draft], [...groupIds], false);
  return next.length === 0 ? null : next;
}

export const LAST_TOOL_HINT = "Keep at least one tool. Check another one first.";

export interface SuggestionItem {
  key: string;
  name: string;
  type: string;
  stored: "all" | string[] | undefined;
}

export interface SectionSuggestion {
  /** Resources that could also run elsewhere, with where each could go. */
  items: Array<{ key: string; name: string; type: string; targets: string[] }>;
  /** Every harness at least one of them could also run on, in registered order. */
  targets: string[];
  /** "3 MCPs could also run on Cursor and Codex". */
  label: string;
  /** "remote-docs, oc-mcp and github". */
  list: string;
}

/**
 * One Also use on line per type section instead of one per pill. Skips
 * resources whose suggestion was dismissed.
 */
export function sectionAlsoUseOn(
  items: readonly SuggestionItem[],
  registered: readonly string[],
  names: Names,
  isDismissed: (name: string, type: string) => boolean,
): SectionSuggestion | null {
  if (registered.length < 2) {
    return null;
  }
  const affected: SectionSuggestion["items"] = [];
  for (const item of items) {
    if (isDismissed(item.name, item.type)) {
      continue;
    }
    const targets = alsoUseOnTargets(item.type, parseStoredHarnessScope(item.stored), registered);
    if (targets.length > 0) {
      affected.push({ key: item.key, name: item.name, type: item.type, targets });
    }
  }
  if (affected.length === 0) {
    return null;
  }
  const wanted = new Set(affected.flatMap((item) => item.targets));
  const targets = registered.filter((id) => wanted.has(id));
  const type = affected[0]?.type ?? "";
  const count = affected.length;
  return {
    items: affected,
    targets,
    label: `${count} ${resourceTypeTabUnit(type, count)} could also run on ${formatHarnessList(targets.map(names))}`,
    list: formatHarnessList(affected.map((item) => item.name)),
  };
}
