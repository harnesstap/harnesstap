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
