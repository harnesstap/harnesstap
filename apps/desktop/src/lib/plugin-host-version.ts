import type { PluginHostCacheVersion } from "./types";

export const LIBRARY_PULL_VERSIONS_TOOLTIP = "Fetch versions from source";

/** Host cache dirs and git SHAs use 7–40 hex characters (same rule as the agent). */
const GIT_SHA_RE = /^[0-9a-f]{7,40}$/i;

/** Short enough that `(git)` stays visible in the closed combobox. */
export const GIT_SHA_VERSION_DISPLAY_LEN = 12;

export function libraryPullUnavailableReason(
  reason?: string | null,
): string | null {
  const trimmed = reason?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function libraryPullVersionsTooltip(reason?: string | null): string {
  return libraryPullUnavailableReason(reason) ?? LIBRARY_PULL_VERSIONS_TOOLTIP;
}

export function libraryPullIsDisabled(reason?: string | null): boolean {
  return libraryPullUnavailableReason(reason) !== null;
}

export function isGitShaVersion(version: string): boolean {
  return GIT_SHA_RE.test(version.trim());
}

export function hostPluginVersionKind(version: string): "git" | "release" {
  return isGitShaVersion(version) ? "git" : "release";
}

export function formatHostPluginVersionId(version: string): string {
  const trimmed = version.trim();
  if (
    isGitShaVersion(trimmed) &&
    trimmed.length > GIT_SHA_VERSION_DISPLAY_LEN
  ) {
    return trimmed.slice(0, GIT_SHA_VERSION_DISPLAY_LEN);
  }
  return trimmed;
}

export function hostPluginVersionBranchName(
  version: string,
  gitRef?: string | null,
): string | null {
  const trimmed = gitRef?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  if (trimmed === version || trimmed === `v${version}`) {
    return null;
  }
  if (isGitShaVersion(trimmed)) {
    return null;
  }
  return trimmed;
}

export function formatHostPluginVersionOption(
  row: Pick<
    PluginHostCacheVersion,
    "version" | "manifest_version" | "advertised" | "git_ref"
  >,
): string {
  const notes: string[] = [hostPluginVersionKind(row.version)];
  const branch = hostPluginVersionBranchName(row.version, row.git_ref);
  if (branch) {
    notes.push(branch);
  }
  if (row.advertised) {
    notes.push("marketplace");
  }
  if (row.manifest_version && row.manifest_version !== row.version) {
    notes.push(`plugin.json ${row.manifest_version}`);
  }
  return `${formatHostPluginVersionId(row.version)} (${notes.join(", ")})`;
}

export function hostPluginVersionHint(
  advertisedVersion: string | null | undefined,
  currentVersion: string | null | undefined,
): string | null {
  if (!advertisedVersion || advertisedVersion === currentVersion) {
    return null;
  }
  return `Marketplace lists ${advertisedVersion}.`;
}

export function hostPluginVersionOptions(
  rows: Array<
    Pick<
      PluginHostCacheVersion,
      "version" | "manifest_version" | "advertised" | "git_ref"
    >
  >,
): Array<{ value: string; label: string; title?: string }> {
  return rows.map((row) => {
    const label = formatHostPluginVersionOption(row);
    if (isGitShaVersion(row.version)) {
      return { value: row.version, label, title: row.version };
    }
    return { value: row.version, label };
  });
}

export function pluginVersionFieldVisible(detail: {
  type: string;
  origin_kind?: string;
  current_version?: string | null;
  available_versions?: unknown[] | null;
}): boolean {
  if (detail.type !== "plugin") {
    return false;
  }
  if ((detail.available_versions?.length ?? 0) > 0) {
    return true;
  }
  if (detail.current_version) {
    return true;
  }
  return detail.origin_kind === "marketplace_link";
}
