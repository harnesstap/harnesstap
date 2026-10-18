import { getDb } from "../db/connection.js";

// Read side of the upstream check. Status imports this module, so it must
// stay free of network and catalog code.

export type UpstreamCheckStatus = "current" | "update" | "major" | "unreachable" | "unpublished";

export interface UpstreamCheckRow {
  plugin_name: string;
  /** `org/catalog/slug@^1.0.0`, or `name@^1.0.0` for a local parent. */
  ref: string;
  local_version: string;
  latest_in_range: string;
  latest_major: string;
  status: UpstreamCheckStatus;
  checked_at: string;
  /** "Not now" remembers the version it dismissed. */
  dismissed_version: string;
  message: string;
}

/** The table as is. No network. */
export function readUpstreamChecks(): UpstreamCheckRow[] {
  return getDb()
    .prepare("SELECT * FROM upstream_checks ORDER BY plugin_name, ref")
    .all() as UpstreamCheckRow[];
}

/** An update the user has not set aside with "Not now" at that version. */
export function isPendingUpdate(row: Pick<UpstreamCheckRow, "status" | "latest_in_range" | "latest_major" | "dismissed_version">): boolean {
  if (row.status === "update") return row.dismissed_version !== row.latest_in_range;
  if (row.status === "major") return row.dismissed_version !== row.latest_major;
  return false;
}

export interface UpstreamCheckSummary {
  count: number;
  major_count: number;
  items: Array<Pick<UpstreamCheckRow, "plugin_name" | "ref" | "local_version" | "latest_in_range" | "latest_major" | "status">>;
}

/**
 * Counts for status and the banner, from the status index only. Dismissed
 * versions are left out; a newer version shows up again.
 */
export function readUpstreamCheckSummary(limit = 5): UpstreamCheckSummary {
  let rows: UpstreamCheckRow[];
  try {
    rows = readPendingRows();
  } catch {
    // A database that predates the table reads as no updates.
    return { count: 0, major_count: 0, items: [] };
  }
  const pending = rows.filter(isPendingUpdate);
  const updates = pending.filter((row) => row.status === "update");
  const majors = pending.filter((row) => row.status === "major");
  return {
    count: updates.length,
    major_count: majors.length,
    items: [...updates, ...majors].slice(0, limit).map(
      ({ plugin_name, ref, local_version, latest_in_range, latest_major, status }) => ({
        plugin_name,
        ref,
        local_version,
        latest_in_range,
        latest_major,
        status,
      }),
    ),
  };
}

function readPendingRows(): UpstreamCheckRow[] {
  return getDb()
    .prepare(
      `SELECT plugin_name, ref, local_version, latest_in_range, latest_major, status, dismissed_version
       FROM upstream_checks WHERE status IN ('update', 'major') ORDER BY plugin_name, ref`,
    )
    .all() as UpstreamCheckRow[];
}

/** One line for `ht status`; empty when there is nothing to say. */
export function formatUpdatesLine(summary: Pick<UpstreamCheckSummary, "count" | "major_count">): string {
  const parts: string[] = [];
  if (summary.count > 0) {
    parts.push(
      `${summary.count} update${summary.count === 1 ? "" : "s"} available (ht plugin update --all)`,
    );
  }
  if (summary.major_count > 0) {
    parts.push(
      `${summary.major_count} major version${summary.major_count === 1 ? "" : "s"} available, not installed automatically`,
    );
  }
  return parts.join("; ");
}

