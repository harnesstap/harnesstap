import type { ViewScope } from "./types";

export const PROFILE_RAIL_ORDER_STORAGE_KEY = "harnesstap.profile-rail-order.v1";

export type ProfileRailOrderMap = {
  home: string[];
  project: string[];
};

export type ProfileRailOrderStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function emptyOrder(): ProfileRailOrderMap {
  return { home: [], project: [] };
}

function parseNameList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

export function applyProfileRailOrder(
  names: readonly string[],
  saved: readonly string[],
): string[] {
  const remaining = new Set(names);
  const ordered: string[] = [];
  for (const name of saved) {
    if (remaining.has(name)) {
      ordered.push(name);
      remaining.delete(name);
    }
  }
  const rest = names
    .filter((name) => remaining.has(name))
    .sort((left, right) => left.localeCompare(right));
  return [...ordered, ...rest];
}

export function reorderProfileNames(
  names: readonly string[],
  fromIndex: number,
  insertBeforeIndex: number,
): string[] {
  if (
    fromIndex < 0
    || fromIndex >= names.length
    || insertBeforeIndex < 0
    || insertBeforeIndex > names.length
  ) {
    return [...names];
  }
  const next = [...names];
  const [item] = next.splice(fromIndex, 1);
  if (item === undefined) {
    return [...names];
  }
  let dest = insertBeforeIndex;
  if (fromIndex < insertBeforeIndex) {
    dest -= 1;
  }
  next.splice(dest, 0, item);
  return next;
}

export function insertBeforeIndexForDrop(
  targetIndex: number,
  placeAfter: boolean,
): number {
  return placeAfter ? targetIndex + 1 : targetIndex;
}

export function loadProfileRailOrder(
  storage: ProfileRailOrderStorage = localStorage,
): ProfileRailOrderMap {
  try {
    const raw = storage.getItem(PROFILE_RAIL_ORDER_STORAGE_KEY);
    if (!raw) {
      return emptyOrder();
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return emptyOrder();
    }
    const record = parsed as Record<string, unknown>;
    return {
      home: parseNameList(record.home),
      project: parseNameList(record.project),
    };
  } catch {
    return emptyOrder();
  }
}

export function saveProfileRailOrder(
  view: ViewScope,
  names: readonly string[],
  storage: ProfileRailOrderStorage = localStorage,
): ProfileRailOrderMap {
  const next: ProfileRailOrderMap = {
    ...loadProfileRailOrder(storage),
    [view]: [...names],
  };
  storage.setItem(PROFILE_RAIL_ORDER_STORAGE_KEY, JSON.stringify(next));
  return next;
}
