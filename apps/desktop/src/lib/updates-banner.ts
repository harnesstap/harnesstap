import type { UpdateRow } from "./api/updates";

export interface UpdatesBannerModel {
  message: string;
  /** Update all only acts on catalog packages and kept-in-sync parents. */
  canUpdateAll: boolean;
  /** Rows "Not now" sets aside, each at the version on offer. */
  dismiss: Array<{ plugin: string; version: string }>;
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** One banner for the Global view, or null when nothing is pending. */
export function updatesBanner(rows: readonly UpdateRow[]): UpdatesBannerModel | null {
  const pending = rows.filter((row) => row.pending);
  if (pending.length === 0) return null;
  const updates = pending.filter((row) => row.status === "update" && row.kind !== "fork");
  const forks = pending.filter((row) => row.status === "update" && row.kind === "fork");
  const majors = pending.filter((row) => row.status === "major");
  const parts: string[] = [];
  if (updates.length > 0) {
    parts.push(`${updates.length} ${plural(updates.length, "update", "updates")} available.`);
  }
  if (forks.length === 1) {
    const [fork] = forks;
    if (fork) {
      parts.push(`${fork.plugin_name}: upstream has ${fork.latest_in_range} (you copied ${fork.local_version}).`);
    }
  } else if (forks.length > 1) {
    parts.push(`${forks.length} separate copies have upstream updates.`);
  }
  if (majors.length > 0) {
    parts.push(
      `${majors.length} major ${plural(majors.length, "version", "versions")} available, never installed automatically.`,
    );
  }
  return {
    message: parts.join(" "),
    canUpdateAll: updates.length > 0,
    dismiss: pending.map((row) => ({
      plugin: row.plugin_name,
      version: row.status === "major" ? row.latest_major : row.latest_in_range,
    })),
  };
}

/** Profiles that get the rail dot: they are, or use, a plugin with an update. */
export function profilesWithUpdates(rows: readonly UpdateRow[]): Set<string> {
  const names = new Set<string>();
  for (const row of rows) {
    if (!row.pending || row.status !== "update") continue;
    for (const profile of row.profiles) names.add(profile);
  }
  return names;
}
