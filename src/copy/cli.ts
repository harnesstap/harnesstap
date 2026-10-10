/**
 * User-facing CLI copy. ASCII punctuation only (DS-6).
 * Command hints always start with `ht`.
 */

export const DRY_RUN_NOTHING_CHANGED = "Dry run. Nothing was changed.";

/** Quote a user-provided token so a pasted hint parses as one Commander argument. */
export function quoteCliArg(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  if (/^[A-Za-z0-9_./:@+=-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function formatHtCommand(path: string): string {
  return `ht ${path}`.trim();
}
