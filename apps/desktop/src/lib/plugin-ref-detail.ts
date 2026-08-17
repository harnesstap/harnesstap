import { LISTABLE_FILTER_RESOURCE_TYPES } from "./resource-filters";
import type { PluginContainedResource } from "./types";

export const PLUGIN_REF_EMPTY_RESOURCES_COPY =
  "Sync to load resources from the install tree.";

export function isPluginTypeResource(type: string): boolean {
  return type === "plugin";
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
