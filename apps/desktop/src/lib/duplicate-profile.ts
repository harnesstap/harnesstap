import type { DuplicateMode } from "./api/library-plugins";

export const DUPLICATE_MODE_COPY: Record<DuplicateMode, { label: string; hint: string }> = {
  inherit: {
    label: "Keep in sync",
    hint: "Parent updates show up here.",
  },
  copy: {
    label: "Separate copy",
    hint: "A standalone copy. Parent updates do not reach it.",
  },
};

/** Suggested name for a duplicate; the user can change it. */
export function defaultDuplicateName(sourceName: string): string {
  return `${sourceName}-copy`;
}

export function duplicateSuccessMessage(
  sourceName: string,
  result: { name: string; mode: DuplicateMode },
): string {
  return result.mode === "inherit"
    ? `Created ${result.name}, kept in sync with ${sourceName}`
    : `Created ${result.name} as a separate copy of ${sourceName}`;
}

export const DETACH_CONFIRM_COPY = {
  title: "Detach from parent",
  description:
    "Copies the parent's items into this profile and stops parent updates. Nothing is deleted. Hidden items stay out.",
  confirmLabel: "Detach",
} as const;

export function detachSuccessMessage(
  profileName: string,
  result: { materialized: number; hidden_cleared: string[] },
): string {
  const copied = `${result.materialized} item${result.materialized === 1 ? "" : "s"}`;
  return `Detached ${profileName}. Copied ${copied} from the parent.`;
}

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

/** One line for the Library detail: `2 items, 1 hidden`. */
export function inheritedSummary(
  items: ReadonlyArray<{ hidden: boolean }>,
  parentMissing?: string,
): string {
  if (parentMissing) return "Parent not installed";
  const hidden = items.filter((item) => item.hidden).length;
  const shown = items.length - hidden;
  const base = `${shown} item${shown === 1 ? "" : "s"}`;
  return hidden > 0 ? `${base}, ${hidden} hidden` : base;
}
