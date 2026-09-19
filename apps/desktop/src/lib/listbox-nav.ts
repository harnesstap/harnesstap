export const LISTBOX_TYPEAHEAD_MS = 500;

export type ListboxNavKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export function isListboxNavKey(key: string): key is ListboxNavKey {
  switch (key) {
    case "ArrowDown":
    case "ArrowUp":
    case "Home":
    case "End":
      return true;
    default:
      return false;
  }
}

/** Move the active option. Does not wrap; Home/End jump to the ends. */
export function nextListboxIndex(
  current: number,
  key: ListboxNavKey,
  count: number,
): number {
  if (count <= 0) {
    return 0;
  }
  const clamped = Math.min(Math.max(current, 0), count - 1);
  switch (key) {
    case "ArrowDown":
      return Math.min(count - 1, clamped + 1);
    case "ArrowUp":
      return Math.max(0, clamped - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default: {
      const neverKey: never = key;
      return neverKey;
    }
  }
}

/**
 * First-letter typeahead from `fromIndex`, wrapping once. Empty buffer misses.
 */
export function matchListboxTypeahead(
  labels: readonly string[],
  buffer: string,
  fromIndex: number,
): number {
  const needle = buffer.trim().toLowerCase();
  if (needle.length === 0 || labels.length === 0) {
    return -1;
  }
  const start = Math.min(Math.max(fromIndex, 0), labels.length - 1);
  for (let offset = 0; offset < labels.length; offset += 1) {
    const index = (start + offset) % labels.length;
    const label = labels[index];
    if (label !== undefined && label.toLowerCase().startsWith(needle)) {
      return index;
    }
  }
  return -1;
}

export function isListboxTypeaheadChar(key: string): boolean {
  return key.length === 1 && !/^\s$/.test(key);
}
