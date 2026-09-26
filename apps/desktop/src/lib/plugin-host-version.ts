import type { PluginHostCacheVersion } from "./types";

export const LIBRARY_PULL_VERSIONS_TOOLTIP = "Fetch versions from source";

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

export function formatHostPluginVersionOption(
  row: Pick<PluginHostCacheVersion, "version" | "manifest_version" | "advertised">,
): string {
  const notes: string[] = [];
  if (row.advertised) {
    notes.push("marketplace");
  }
  if (row.manifest_version && row.manifest_version !== row.version) {
    notes.push(`plugin.json ${row.manifest_version}`);
  }
  if (notes.length === 0) {
    return row.version;
  }
  return `${row.version} (${notes.join(", ")})`;
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
  rows: Array<Pick<PluginHostCacheVersion, "version" | "manifest_version" | "advertised">>,
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: row.version,
    label: formatHostPluginVersionOption(row),
  }));
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
