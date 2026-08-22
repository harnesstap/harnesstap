import type { LibraryPluginHead } from "./api/library-plugins";
import { resourceDisplayName } from "./resource-search";
import type { LibraryResource } from "./types";

export type LibraryListKind = "resource" | "plugin-package";

export const LIBRARY_FILTER_PLUGIN = "plugin";
export const LIBRARY_FILTER_PLUGIN_REF = "plugin_ref";

export type LibraryListEntry = LibraryResource & {
  listKind: LibraryListKind;
  version?: string;
  dirty?: boolean;
  pluginOrigin?: LibraryPluginHead["origin"];
  originOutdated?: boolean;
  tags?: string[];
};

function isLibraryListEntry(entry: LibraryResource): entry is LibraryListEntry {
  return "listKind" in entry;
}

/** Filter/group key: plugin packages vs composition-ref resources. */
export function libraryFilterType(entry: LibraryResource): string {
  if (isLibraryListEntry(entry) && entry.listKind === "plugin-package") {
    return LIBRARY_FILTER_PLUGIN;
  }
  if (entry.type === "plugin") {
    return LIBRARY_FILTER_PLUGIN_REF;
  }
  return entry.type;
}

export function libraryFilterTypeLabel(filterType: string): string {
  return filterType === LIBRARY_FILTER_PLUGIN_REF ? "plugin ref" : filterType;
}

export function groupLibraryListByFilterType(
  entries: LibraryListEntry[],
): Array<{ type: string; label: string; resources: LibraryListEntry[] }> {
  const groups = new Map<string, LibraryListEntry[]>();
  for (const entry of entries) {
    const key = libraryFilterType(entry);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, rows]) => ({
      type,
      label: libraryFilterTypeLabel(type),
      resources: [...rows].sort((a, b) =>
        resourceDisplayName(a).localeCompare(resourceDisplayName(b)),
      ),
    }));
}

export function mergeLibraryList(
  resources: LibraryResource[],
  plugins: LibraryPluginHead[],
  originOutdatedIds?: ReadonlySet<string>,
): LibraryListEntry[] {
  const resourceRows: LibraryListEntry[] = resources.map((resource) => ({
    ...resource,
    listKind: "resource",
  }));
  const packageRows: LibraryListEntry[] = plugins.map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    type: "plugin",
    namespace: null,
    description: plugin.description,
    source: null,
    updated_at: null,
    origin_kind: null,
    listKind: "plugin-package",
    version: plugin.version,
    dirty: plugin.dirty,
    pluginOrigin: plugin.origin,
    originOutdated: originOutdatedIds?.has(plugin.id) ?? false,
    tags: plugin.tags,
  }));
  return [...resourceRows, ...packageRows];
}

export function isPluginRefRow(entry: LibraryListEntry): boolean {
  return entry.listKind === "resource" && entry.type === "plugin";
}

export function libraryRowBadge(entry: LibraryListEntry): string | null {
  if (entry.listKind === "plugin-package") {
    return `${entry.version ?? ""}${entry.dirty ? "*" : ""}`;
  }
  if (isPluginRefRow(entry)) {
    return "plugin ref";
  }
  return null;
}

export function libraryRowUpdateBadge(entry: LibraryListEntry): string | null {
  if (entry.listKind === "plugin-package" && entry.originOutdated) {
    return "Update available";
  }
  return null;
}
