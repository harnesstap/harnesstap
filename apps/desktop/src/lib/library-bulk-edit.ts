import { checkAllCheckboxState } from "./publish-catalog-selection";

/** Confirm dialogs list this many rows before Show more / Show all. */
export const LIBRARY_BULK_DELETE_PREVIEW = 5;

export function libraryBulkDeleteShowAllLabel(total: number): string {
  return `Show all (${total})`;
}

export function libraryBulkDeleteVisibleCount(
  total: number,
  revealed: number,
): number {
  if (total <= 0) {
    return 0;
  }
  return Math.min(total, Math.max(LIBRARY_BULK_DELETE_PREVIEW, revealed));
}

export function libraryBulkDeleteLine(typeLabel: string, name: string): string {
  return `${typeLabel} ${name}`;
}

export function selectAllCheckboxState(
  visibleIds: readonly string[],
  selected: ReadonlySet<string>,
): boolean | "indeterminate" {
  const selectedVisible = visibleIds.filter((id) => selected.has(id)).length;
  return checkAllCheckboxState(visibleIds.length, selectedVisible);
}

/** Select or deselect every id currently visible. Hidden selection is unchanged. */
export function toggleSelectAllVisible(
  visibleIds: readonly string[],
  selected: ReadonlySet<string>,
): Set<string> {
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const next = new Set(selected);
  if (allVisibleSelected) {
    for (const id of visibleIds) {
      next.delete(id);
    }
    return next;
  }
  for (const id of visibleIds) {
    next.add(id);
  }
  return next;
}

export function pruneSelectedIds(
  selected: ReadonlySet<string>,
  knownIds: ReadonlySet<string>,
): Set<string> {
  const next = new Set<string>();
  for (const id of selected) {
    if (knownIds.has(id)) {
      next.add(id);
    }
  }
  return next;
}
