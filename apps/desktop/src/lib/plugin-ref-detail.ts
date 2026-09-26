import { isPackageEntryFileName } from "./resource-display";
import {
  LISTABLE_FILTER_RESOURCE_TYPES,
  formatOriginKindLabel,
} from "./resource-filters";
import type { PluginContainedResource } from "./types";

export const PLUGIN_REF_EMPTY_RESOURCES_COPY = "Nothing loaded yet.";

export const CONTAINED_FILES_PAGE_SIZE = 20;

export function isPluginTypeResource(type: string): boolean {
  return type === "plugin";
}

export function pluginRefShowsMarketplaceUrl(detail: {
  type: string;
  origin_kind: string;
  marketplace_url?: string | null;
}): boolean {
  return (
    isPluginTypeResource(detail.type) &&
    formatOriginKindLabel(detail.origin_kind) === "Marketplace" &&
    Boolean(detail.marketplace_url)
  );
}

export function resourceDetailUsesFileTree(detail: {
  type: string;
  filesystem_path?: string | null;
  source: string;
}): boolean {
  if (isPluginTypeResource(detail.type)) {
    return true;
  }
  const path = (detail.filesystem_path || detail.source).replace(/[\\/]+$/, "");
  const name = path.split(/[/\\]/).pop() ?? "";
  return isPackageEntryFileName(name);
}

export function sliceContainedFiles(
  files: PluginContainedResource[],
  visibleCount: number,
): PluginContainedResource[] {
  if (visibleCount >= files.length) {
    return files;
  }
  return files.slice(0, Math.max(0, visibleCount));
}

export function containedFilesCanRevealMore(
  visibleCount: number,
  loadedCount: number,
  hasMore: boolean,
): boolean {
  return visibleCount < loadedCount || hasMore;
}

const TYPE_ORDER = LISTABLE_FILTER_RESOURCE_TYPES.filter(
  (type) => type !== "plugin" && type !== "plugin_ref",
);

export function groupContainedResources(
  resources: PluginContainedResource[],
): Array<{ type: string; resources: PluginContainedResource[] }> {
  const buckets = new Map<string, PluginContainedResource[]>();
  for (const row of resources) {
    const list = buckets.get(row.type) ?? [];
    list.push(row);
    buckets.set(row.type, list);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  }
  const groups: Array<{ type: string; resources: PluginContainedResource[] }> = [];
  for (const type of TYPE_ORDER) {
    const list = buckets.get(type);
    if (list && list.length > 0) {
      groups.push({ type, resources: list });
      buckets.delete(type);
    }
  }
  const leftover = [...buckets.keys()].sort((a, b) => a.localeCompare(b));
  for (const type of leftover) {
    const list = buckets.get(type);
    if (list && list.length > 0) {
      groups.push({ type, resources: list });
    }
  }
  return groups;
}
