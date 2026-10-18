import type { UpdateRow } from "./api/updates";

export interface UpdatesBannerModel {
  /** One plain sentence: what is available and what you have. */
  message: string;
  /** Plugins the banner's Update installs, one by one. */
  plugins: string[];
  /** Rows Dismiss sets aside, each at the version on offer. */
  dismiss: Array<{ plugin: string; version: string }>;
}

/**
 * Updates the banner and the rail badge act on: minor or patch updates for a
 * pulled plugin or a parent. A separate copy (fork) only gets a bell notice,
 * and a major only goes to the bell.
 */
export function actionableUpdates(rows: readonly UpdateRow[]): UpdateRow[] {
  return rows.filter((row) => row.pending && row.status === "update" && row.kind !== "fork");
}

function affects(row: UpdateRow, profileName: string): boolean {
  return row.plugin_name === profileName || row.profiles.includes(profileName);
}

/** The banner for one profile's page, or null when nothing applies to it. */
export function profileUpdatesBanner(
  rows: readonly UpdateRow[],
  profileName: string | null,
  handled: ReadonlySet<string> = new Set(),
): UpdatesBannerModel | null {
  if (!profileName) return null;
  const mine = actionableUpdates(rows).filter(
    (row) => affects(row, profileName) && !handled.has(handledKey(row)),
  );
  if (mine.length === 0) return null;
  const [only] = mine;
  const message =
    mine.length === 1 && only
      ? `${only.plugin_name}: ${only.latest_in_range} is available (you have ${only.local_version}).`
      : `${mine.length} updates are available: ${mine.map((row) => row.plugin_name).join(", ")}.`;
  return {
    message,
    plugins: mine.map((row) => row.plugin_name),
    dismiss: mine.map((row) => ({ plugin: row.plugin_name, version: row.latest_in_range })),
  };
}

/** A row the user already updated this session, keyed by the version on offer. */
export function handledKey(row: Pick<UpdateRow, "plugin_name" | "latest_in_range">): string {
  return `${row.plugin_name}@${row.latest_in_range}`;
}

/**
 * Profiles that get the rail badge: they are, or use, a plugin with an update.
 * An update already read in the bell (`seen`, keyed like handledKey) no longer
 * badges the rail.
 */
export function profilesWithUpdates(rows: readonly UpdateRow[], seen: ReadonlySet<string> = new Set()): Set<string> {
  const names = new Set<string>();
  for (const row of actionableUpdates(rows)) {
    if (seen.has(handledKey(row))) continue;
    for (const profile of row.profiles) names.add(profile);
  }
  return names;
}
