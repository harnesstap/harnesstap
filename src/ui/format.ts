import { formatCount } from "../copy/plurals.js";

export { formatCount } from "../copy/plurals.js";

export function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 3) return ".".repeat(Math.max(1, width));
  return `${value.slice(0, width - 3)}...`;
}

export function shortenId(value: string): string {
  if (value.length <= 10) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function formatAbsoluteTime(
  value: string | number | Date,
  options?: { includeTime?: boolean },
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (options?.includeTime) {
    return date.toISOString().slice(0, 19).replace("T", " ");
  }
  return date.toISOString().slice(0, 10);
}

export function formatRelativeTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const diffMs = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return `${formatCount(Math.max(1, Math.floor(diffMs / 1000)), "second")} ago`;
  }
  if (diffMs < hour) {
    return `${formatCount(Math.floor(diffMs / minute), "minute")} ago`;
  }
  if (diffMs < day) {
    return `${formatCount(Math.floor(diffMs / hour), "hour")} ago`;
  }
  if (diffMs <= 30 * day) {
    return `${formatCount(Math.floor(diffMs / day), "day")} ago`;
  }
  return formatAbsoluteTime(date);
}

export function formatRelativeTimeWithAbsolute(value: string | number | Date): string {
  const relative = formatRelativeTime(value);
  const absolute = formatAbsoluteTime(value, { includeTime: true });
  if (relative === absolute) return relative;
  return `${relative} (${absolute})`;
}

