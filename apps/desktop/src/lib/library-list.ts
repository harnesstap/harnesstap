import type { LibraryPluginHead } from "./api/library-plugins";
import type { LibraryResource } from "./types";

export type LibraryListKind = "resource" | "plugin-package";

export type LibraryListEntry = LibraryResource & {
  listKind: LibraryListKind;
  version?: string;
  dirty?: boolean;
  pluginOrigin?: LibraryPluginHead["origin"];
  tags?: string[];
};

export function mergeLibraryList(
  resources: LibraryResource[],
  plugins: LibraryPluginHead[],
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
