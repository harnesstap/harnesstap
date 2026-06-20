export function toggleInMap<TKey, TItem>(
  map: Map<TKey, TItem>,
  key: TKey,
  item: TItem,
): Map<TKey, TItem> {
  const next = new Map(map);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.set(key, item);
  }
  return next;
}

export function selectAllVisible<TKey, TItem>(
  map: Map<TKey, TItem>,
  items: TItem[],
  keyFn: (item: TItem) => TKey,
): Map<TKey, TItem> {
  const next = new Map(map);
  for (const item of items) {
    next.set(keyFn(item), item);
  }
  return next;
}

export function clearVisible<TKey, TItem>(
  map: Map<TKey, TItem>,
  items: TItem[],
  keyFn: (item: TItem) => TKey,
): Map<TKey, TItem> {
  const next = new Map(map);
  for (const item of items) {
    next.delete(keyFn(item));
  }
  return next;
}

export function toggleCheckedAtIndex<T extends { checked: boolean }>(
  items: T[],
  index: number,
): T[] {
  return items.map((item, itemIndex) =>
    itemIndex === index ? { ...item, checked: !item.checked } : item,
  );
}

export function setCheckedForIndexes<T extends { checked: boolean }>(
  items: T[],
  indexes: Set<number>,
  checked: boolean,
): T[] {
  return items.map((item, index) =>
    indexes.has(index) ? { ...item, checked } : item,
  );
}
