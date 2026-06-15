/** Recursively sort object keys for deterministic TOML output. */
export function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeysDeep(record[key]);
    }
    return sorted as T;
  }
  return value;
}

export function sortStringRecord(record: Record<string, string>): Record<string, string> {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = record[key] ?? "";
  }
  return sorted;
}
