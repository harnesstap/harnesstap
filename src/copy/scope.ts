import { getPlatform } from "../platforms/registry.js";
import type { HarnessScope } from "../services/harness-scope.js";

/** DS-1 scope copy. ASCII punctuation only. */

export const SCOPE_COPY = {
  appliesToAll: "Applies to all your harnesses",
  notSetUp: "Not set up for any harness yet",
  detectHarnesses: "Detect harnesses",
  foundInSettingsSuffix: "Found in its settings.",
  useOn: "Use on",
  selectAll: "Select all",
  none: "None",
  emptyHint: "Pick at least one harness",
  linkedTooltip: "These read the same folder, so they share one setting",
  allTooltip: "On all harnesses. Pick which ones",
  orphanedTooltip: "Its harnesses are gone. Pick new ones",
  main: "Main",
  mainTooltip: "Your main harness. It wins when harnesses disagree.",
  alsoUseOnPrefix: "Also use on",
  notNow: "Not now",
  willWrite: "Will write",
  upToDate: "Up to date",
  notInProfile: "Not in profile",
  willRemove: "Will remove",
  keptYouChanged: "Kept. You changed it.",
  keptNotMadeByHarnessTap: "Kept. Not made by HarnessTap.",
} as const;

export function harnessDisplayName(id: string): string {
  return getPlatform(id)?.name ?? id;
}

/** Join display names: "A and B" / "A, B and C". */
export function formatHarnessList(names: readonly string[]): string {
  if (names.length === 0) {
    return "";
  }
  if (names.length === 1) {
    return names[0] ?? "";
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function formatHarnessIds(ids: readonly string[]): string {
  return formatHarnessList(ids.map(harnessDisplayName));
}

/**
 * Subset scope line: "Only on Claude Code and Codex",
 * or "Only on Claude Code, Codex, Cursor and {n} more" for 4+.
 */
export function subsetScopeLine(ids: readonly string[]): string {
  if (ids.length === 0) {
    return SCOPE_COPY.notSetUp;
  }
  if (ids.length <= 3) {
    return `Only on ${formatHarnessIds(ids)}`;
  }
  const visible = ids.slice(0, 3).map(harnessDisplayName);
  const extra = ids.length - visible.length;
  return `Only on ${visible.join(", ")} and ${extra} more`;
}

export function scopeLine(
  scope: HarnessScope,
  options?: { originPortable?: boolean },
): string {
  if (scope.kind === "all") {
    return SCOPE_COPY.appliesToAll;
  }
  const line = subsetScopeLine(scope.harnesses);
  if (options?.originPortable && scope.harnesses.length === 1) {
    return `${line}. ${SCOPE_COPY.foundInSettingsSuffix}`;
  }
  return line;
}

export function alsoUseOnLabel(ids: readonly string[]): string {
  if (ids.length <= 3) {
    return `${SCOPE_COPY.alsoUseOnPrefix} ${formatHarnessIds(ids)}`;
  }
  const visible = ids.slice(0, 3).map(harnessDisplayName);
  const extra = ids.length - visible.length;
  return `${SCOPE_COPY.alsoUseOnPrefix} ${visible.join(", ")} and ${extra} more`;
}

export function portableMcpTooltip(ids: readonly string[]): string {
  return `This server works anywhere. Add it to ${formatHarnessIds(ids)} too.`;
}

export function nowOnToast(ids: readonly string[]): string {
  return `Now on ${formatHarnessIds(ids)}`;
}

export function skippedNotUsedOnFooter(count: number, harnessId: string): string {
  return `${count} skipped. Not used on ${harnessDisplayName(harnessId)}.`;
}

export function portableScopeTip(input: {
  resourceName: string;
  targetIds: readonly string[];
  command: string;
}): string {
  return `Tip: "${input.resourceName}" also works on ${formatHarnessIds(input.targetIds)}. Run ${input.command}.`;
}
