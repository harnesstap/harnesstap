export function formatLibraryTimestamp(
  iso: string,
  options?: { now?: Date; locale?: string },
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const now = options?.now ?? new Date();
  const locale = options?.locale;
  const absolute = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
  const relative = formatRelativeTime(date, now, locale);
  return `${absolute} (${relative})`;
}

function formatRelativeTime(date: Date, now: Date, locale?: string): string {
  const deltaSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  const units: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
    { unit: "year", seconds: 365 * 24 * 60 * 60 },
    { unit: "month", seconds: 30 * 24 * 60 * 60 },
    { unit: "day", seconds: 24 * 60 * 60 },
    { unit: "hour", seconds: 60 * 60 },
    { unit: "minute", seconds: 60 },
  ];
  for (const { unit, seconds } of units) {
    if (abs >= seconds) {
      return formatter.format(Math.trunc(deltaSeconds / seconds), unit);
    }
  }
  return formatter.format(deltaSeconds, "second");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatLocalWallClock(date: Date): string {
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function countLabel(count: number, unit: string): string {
  return count === 1 ? `1 ${unit} ago` : `${count} ${unit}s ago`;
}

export function formatLastEditRelative(
  date: Date,
  now: Date,
): string {
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const year = 365 * day;
  if (diffMs < minute) {
    return "just now";
  }
  if (diffMs < hour) {
    return countLabel(Math.floor(diffMs / minute), "minute");
  }
  if (diffMs < day) {
    return countLabel(Math.floor(diffMs / hour), "hour");
  }
  if (diffMs < year) {
    return countLabel(Math.floor(diffMs / day), "day");
  }
  return countLabel(Math.floor(diffMs / year), "year");
}

export function formatLastEditLine(
  iso: string,
  options?: { now?: Date },
): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const now = options?.now ?? new Date();
  return `Last edit ${formatLastEditRelative(date, now)} (${formatLocalWallClock(date)})`;
}
