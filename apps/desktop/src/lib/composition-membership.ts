import {
  libraryFilterType,
  libraryFilterTypeLabel,
  mergeLibraryList,
  type LibraryListEntry,
} from "./library-list";
import { duplicatePluginNames } from "./resource-display";
import { resourceDisplayName } from "./resource-search";
import type { LibraryPlugin, LibraryResource } from "./types";

const LEADING_COMPOSITION_TYPES = ["plugin", "plugin_ref"] as const;

export type CompositionPlugin = Pick<
  LibraryPlugin,
  "id" | "name" | "version" | "tags" | "description"
>;

export function compositionSearchType(resource: LibraryResource): string {
  return libraryFilterType(resource);
}

export function compareCompositionGroupTypes(left: string, right: string): number {
  const leftLead = (LEADING_COMPOSITION_TYPES as readonly string[]).indexOf(left);
  const rightLead = (LEADING_COMPOSITION_TYPES as readonly string[]).indexOf(right);
  if (leftLead !== -1 || rightLead !== -1) {
    if (leftLead === -1) {
      return 1;
    }
    if (rightLead === -1) {
      return -1;
    }
    return leftLead - rightLead;
  }
  return left.localeCompare(right);
}

export function groupCompositionMembership(
  resources: LibraryResource[],
): Array<{ type: string; label: string; resources: LibraryResource[] }> {
  const collidingNames = duplicatePluginNames(resources);
  const groups = new Map<string, LibraryResource[]>();
  for (const resource of resources) {
    const type = compositionSearchType(resource);
    const bucket = groups.get(type);
    if (bucket) {
      bucket.push(resource);
    } else {
      groups.set(type, [resource]);
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => compareCompositionGroupTypes(left, right))
    .map(([type, rows]) => ({
      type,
      label: libraryFilterTypeLabel(type),
      resources: [...rows].sort((a, b) =>
        resourceDisplayName(a, collidingNames).localeCompare(
          resourceDisplayName(b, collidingNames),
        ),
      ),
    }));
}

/** Rows already attached to a plugin or profile (ids from membership). */
export function filterCompositionMembers(
  catalog: readonly LibraryResource[],
  selectedIds: readonly string[],
): LibraryResource[] {
  const selected = new Set(selectedIds);
  return catalog.filter((row) => selected.has(row.id));
}

/** Membership rows for plugin details, including attachments missing from the catalog. */
export function pluginDetailCompositionEntries(
  catalog: readonly LibraryResource[],
  selectedIds: readonly string[],
  detailResources: ReadonlyArray<{
    id: string;
    type: string;
    name: string;
    source: string;
  }>,
): LibraryResource[] {
  const members = filterCompositionMembers(catalog, selectedIds);
  const seen = new Set(members.map((row) => row.id));
  const extras: LibraryResource[] = [];
  for (const row of detailResources) {
    if (seen.has(row.id)) {
      continue;
    }
    extras.push({
      id: row.id,
      name: row.name,
      type: row.type,
      namespace: null,
      description: null,
      source: row.source,
    });
    seen.add(row.id);
  }
  return [...members, ...extras];
}

/** Exclude keys for the add-from-library checklist (`type:name` and `type:id`). */
export function compositionExcludeKeys(
  entries: readonly LibraryResource[],
): Set<string> {
  const keys = new Set<string>();
  for (const entry of entries) {
    const type = compositionSearchType(entry);
    keys.add(`${type}:${entry.name}`);
    keys.add(`${type}:${entry.id}`);
  }
  return keys;
}

export function mergeCompositionMembership(
  resources: LibraryResource[],
  plugins: CompositionPlugin[],
  options?: {
    excludePluginName?: string;
    excludeProfileTagged?: boolean;
  },
): LibraryListEntry[] {
  const excludeName = options?.excludePluginName;
  const heads = plugins
    .filter((plugin) => {
      if (excludeName && plugin.name === excludeName) {
        return false;
      }
      if (options?.excludeProfileTagged && plugin.tags.includes("profile")) {
        return false;
      }
      return true;
    })
    .map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      tags: plugin.tags,
      description: plugin.description,
      origin: "authored" as const,
      dirty: false,
      org_slug: "",
      catalog_slug: "",
    }));
  return mergeLibraryList(resources, heads);
}

export function isCompositionPluginPackage(
  resource: LibraryResource,
): boolean {
  return "listKind" in resource && resource.listKind === "plugin-package";
}

export function compositionResourceSelector(resource: LibraryResource): string {
  return resource.namespace
    ? `${resource.name}@${resource.namespace}`
    : resource.name;
}
