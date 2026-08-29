export class LockExportTimestampError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockExportTimestampError";
  }
}

function normalizeUtcDesignator(value: string): string {
  return value.endsWith("Z") ? `${value.slice(0, -1)}+00:00` : value;
}

function formatUtc(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 19)}+00:00`;
}

function parseTimezoneAwareIso(value: string): string | undefined {
  const normalized = normalizeUtcDesignator(value.trim());
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  // Require an explicit timezone (Z or ±HH:MM). Bare local datetimes are rejected.
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())) {
    return undefined;
  }
  return new Date(parsed).toISOString().endsWith("Z")
    ? formatUtc(new Date(parsed))
    : normalized;
}

/**
 * Precedence: `--timestamp` > `SOURCE_DATE_EPOCH` > lockfile `generated_at` > Unix epoch.
 */
export function resolveExportTimestamp(
  explicit: string | undefined,
  lockfileGeneratedAt: string | undefined,
  sourceDateEpoch: string | undefined = process.env.SOURCE_DATE_EPOCH,
): string {
  if (explicit !== undefined) {
    const parsed = parseTimezoneAwareIso(explicit);
    if (!parsed) {
      throw new LockExportTimestampError(
        `Invalid timestamp ${JSON.stringify(explicit)}. Expected timezone-aware ISO 8601, e.g. 2024-06-01T00:00:00+00:00.`,
      );
    }
    return parsed;
  }

  if (sourceDateEpoch) {
    const seconds = Number(sourceDateEpoch);
    if (Number.isInteger(seconds) && seconds >= 0) {
      return formatUtc(new Date(seconds * 1000));
    }
  }

  if (lockfileGeneratedAt && lockfileGeneratedAt.trim().length > 0) {
    return lockfileGeneratedAt.trim();
  }

  return "1970-01-01T00:00:00+00:00";
}
