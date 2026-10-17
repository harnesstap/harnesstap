import type { DuplicateMode } from "./api/library-plugins";

/** Option copy for the Duplicate dialog; `parent` is the source profile's name. */
export function duplicateModeCopy(parent: string): Record<DuplicateMode, { label: string; hint: string }> {
  return {
    inherit: {
      label: "Keep in sync",
      hint: `Gets ${parent}'s updates. Hide anything you don't need.`,
    },
    copy: {
      label: "Separate copy",
      hint: "Starts as a copy. Yours to change from here.",
    },
  };
}

/** Dialog title: the noun of what is duplicated. */
export function duplicateDialogTitle(isProfile: boolean): string {
  return isProfile ? "Duplicate profile" : "Duplicate plugin";
}

/** Suggested name for a duplicate; the user can change it. */
export function defaultDuplicateName(sourceName: string): string {
  return `${sourceName}-copy`;
}

/** Inline check while typing; null when the name is fine. */
export function duplicateNameError(name: string, existing: ReadonlySet<string>): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name.";
  if (existing.has(trimmed)) return `${trimmed} already exists.`;
  return null;
}

export function duplicateSuccessMessage(
  sourceName: string,
  result: { name: string; mode: DuplicateMode },
): string {
  return result.mode === "inherit"
    ? `${result.name} created. Synced with ${sourceName}.`
    : `${result.name} created. Separate copy of ${sourceName}.`;
}

/** Header chip of a kept-in-sync profile, with its tooltip. */
export function syncedChip(upstream: { ref: string; version_at_link?: string }, parentName: string, version?: string) {
  const shown = version || upstream.version_at_link || "";
  return {
    label: `Synced with ${parentName}${shown ? ` ${shown}` : ""}`,
    tooltip: `Updates from ${parentName} show up here`,
  };
}

/** Parent display name from an upstream ref: `acme/team/backend@^1.0.0` reads as `backend`. */
export function parentNameFromRef(ref: string): string {
  const base = ref.split("@")[0] ?? ref;
  return base.split("/").pop() || base;
}

export function detachedMessage(profileName: string, parentName: string): string {
  return `${profileName} detached from ${parentName}.`;
}

/** Toast after ticking or unticking an inherited row. */
export function inheritedToggleMessage(name: string, nowHidden: boolean): string {
  return nowHidden ? `${name} hidden` : `${name} shown`;
}

/** How long Undo stays on the detach toast. */
export const DETACH_UNDO_MS = 10_000;

/** Hidden list after ticking or unticking one inherited item. */
export function toggleExcludeEntry(excludes: readonly string[], key: string): string[] {
  return excludes.includes(key)
    ? excludes.filter((entry) => entry !== key)
    : [...excludes, key];
}

/** `skill:review` reads as `review (skill)`; a plugin dependency reads as its name. */
export function inheritedItemLabel(item: { type: string; name: string }): string {
  return item.type === "plugin" ? item.name : `${item.name} (${item.type})`;
}

/** Tooltips on an inherited Composition row: the checkbox and the state icon. */
export function inheritedRowTooltips(item: { hidden: boolean }, parentName: string) {
  return {
    checkbox: item.hidden ? "Include" : "Hide from this profile",
    state: item.hidden ? `Hidden. Comes from ${parentName}` : `From ${parentName}`,
  };
}
