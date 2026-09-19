import type { LibraryPluginHead } from "./api/library-plugins";
import { resourceDisplayName } from "./resource-search";
import { resourceTypeTabLabel } from "./resource-type-tabs";
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

/** Human type tab label (always a category name, not `plugin 1`). */
export function libraryFilterTypeLabel(filterType: string): string {
  return resourceTypeTabLabel(filterType);
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

/** Virtualizer estimates only. Measured row height can grow when copy wraps. */
export const LIBRARY_ROW_HEIGHT = 56;
export const LIBRARY_ROW_HEIGHT_WITH_SUBTITLE = 72;

/** Stable id used for listbox options, last-opened restore, and detail open. */
export function libraryRowSelector(entry: LibraryListEntry): string {
  switch (entry.listKind) {
    case "plugin-package":
      return entry.name;
    case "resource":
      return entry.id;
    default: {
      const neverKind: never = entry.listKind;
      return neverKind;
    }
  }
}

export function libraryRowHasSubtitle(entry: LibraryListEntry): boolean {
  return Boolean(libraryRowBadge(entry) || entry.description);
}

export function libraryRowHeight(entry: LibraryListEntry): number {
  return libraryRowHasSubtitle(entry)
    ? LIBRARY_ROW_HEIGHT_WITH_SUBTITLE
    : LIBRARY_ROW_HEIGHT;
}

export type LibraryScopeName = {
  base: string;
  profile: string | null;
};

/** Split `<base>@<profile>` display names. No `@` means the whole string is the base. */
export function parseLibraryScopeName(displayName: string): LibraryScopeName {
  const at = displayName.lastIndexOf("@");
  if (at <= 0 || at === displayName.length - 1) {
    return { base: displayName, profile: null };
  }
  return {
    base: displayName.slice(0, at),
    profile: displayName.slice(at + 1),
  };
}

export type ScopedLibraryRow<T> = T & { scopedProfile: string | null };

/**
 * Indent `<base>@<profile>` copies under `<base>` when that base row exists.
 * Rows with no matching base stay ungrouped.
 */
export function groupScopedLibraryRows<T>(
  rows: readonly T[],
  displayNameOf: (row: T) => string,
): Array<ScopedLibraryRow<T>> {
  const bases = new Set<string>();
  for (const row of rows) {
    const parsed = parseLibraryScopeName(displayNameOf(row));
    if (parsed.profile === null) {
      bases.add(parsed.base);
    }
  }
  const decorated: Array<ScopedLibraryRow<T>> = rows.map((row) => {
    const parsed = parseLibraryScopeName(displayNameOf(row));
    const scopedProfile =
      parsed.profile !== null && bases.has(parsed.base) ? parsed.profile : null;
    return { ...row, scopedProfile };
  });
  decorated.sort((left, right) => {
    const leftName = displayNameOf(left);
    const rightName = displayNameOf(right);
    const leftParsed = parseLibraryScopeName(leftName);
    const rightParsed = parseLibraryScopeName(rightName);
    const leftKey = leftParsed.profile !== null && bases.has(leftParsed.base)
      ? leftParsed.base
      : leftName;
    const rightKey = rightParsed.profile !== null && bases.has(rightParsed.base)
      ? rightParsed.base
      : rightName;
    const byBase = leftKey.localeCompare(rightKey);
    if (byBase !== 0) {
      return byBase;
    }
    if (left.scopedProfile === null && right.scopedProfile !== null) {
      return -1;
    }
    if (left.scopedProfile !== null && right.scopedProfile === null) {
      return 1;
    }
    return (left.scopedProfile ?? "").localeCompare(right.scopedProfile ?? "");
  });
  return decorated;
}

export function scopedCopyHoverText(profile: string): string {
  return `Scoped copy in ${profile}`;
}
