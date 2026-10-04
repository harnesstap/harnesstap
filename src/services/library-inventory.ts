import { isFrozenPlugin, listPlugins } from "../models/plugin-model.js";
import { listResources } from "../models/resource.js";
import type { Plugin, PluginOrigin, Resource } from "../types.js";
import {
  duplicatePluginNames,
  formatResourceDisplayName,
} from "../ui/resource-display.js";
import {
  matchesListSearchQuery,
  parseListSearchQuery,
} from "../ui/list-search.js";

export type LibraryInventoryListKind = "resource" | "plugin-package";

export type LibraryInventoryRow = {
  listKind: LibraryInventoryListKind;
  id: string;
  name: string;
  type: string;
  namespace: string | null;
  description: string | null;
  source?: string | null;
  updated_at?: string | null;
  origin_kind?: string | null;
  origin_ref?: string | null;
  version?: string;
  dirty?: boolean;
  pluginOrigin?: PluginOrigin;
  tags?: string[];
  hook?: {
    event: string;
    script: string;
    matcher?: string;
    type?: string;
  };
};

const RESOURCE_TYPE_PREFIXES = new Set([
  "instruction",
  "skill",
  "rule",
  "mcp_server",
  "permission",
  "hook",
  "agent",
  "command",
  "env_var",
  "model_config",
  "plugin",
  "plugin_pin",
  "plugin_ref",
]);

function canonicalSearchType(section: string): string {
  return section === "plugin_pin" ? "plugin" : section;
}

export function inventoryFilterType(row: LibraryInventoryRow): string {
  if (row.listKind === "plugin-package") {
    return "plugin";
  }
  if (row.type === "plugin") {
    return "plugin_ref";
  }
  return row.type;
}

function librarySearchType(row: LibraryInventoryRow): string {
  return inventoryFilterType(row);
}

function resourceTypePrefix(section: string | undefined): string | undefined {
  if (section === undefined) {
    return undefined;
  }
  const normalized = section.toLowerCase();
  return RESOURCE_TYPE_PREFIXES.has(normalized) ? normalized : undefined;
}

function rowMatchesTypePrefix(row: LibraryInventoryRow, section: string): boolean {
  const wanted = canonicalSearchType(section);
  const searchType = librarySearchType(row);
  if (wanted === "plugin") {
    return searchType === "plugin" || searchType === "plugin_ref";
  }
  return searchType === wanted;
}

function namespaceForRow(namespace: string): string | null {
  const trimmed = namespace.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resourceToInventoryRow(resource: Resource): LibraryInventoryRow {
  return {
    listKind: "resource",
    id: resource.id,
    name: resource.name,
    type: resource.type,
    namespace: namespaceForRow(resource.namespace),
    description: resource.description ?? null,
    source: resource.source,
    updated_at: resource.updated_at,
    origin_kind: resource.origin_kind,
    origin_ref: resource.origin_ref || null,
  };
}

function pluginToInventoryRow(plugin: Plugin): LibraryInventoryRow {
  return {
    listKind: "plugin-package",
    id: plugin.id,
    name: plugin.name,
    type: "plugin",
    namespace: null,
    description: plugin.description ?? null,
    source: null,
    updated_at: plugin.updated_at,
    origin_kind: null,
    origin_ref: null,
    version: plugin.version,
    dirty: plugin.dirty,
    pluginOrigin: plugin.origin,
    tags: plugin.tags,
  };
}

function displayName(
  row: LibraryInventoryRow,
  duplicateNames: ReadonlySet<string>,
): string {
  return formatResourceDisplayName(row, {
    disambiguatePlugin: duplicateNames.has(row.name),
  });
}

function rowSearchHaystack(
  row: LibraryInventoryRow,
  duplicateNames: ReadonlySet<string>,
): string {
  return `${row.name} ${displayName(row, duplicateNames)} ${row.description ?? ""} ${row.namespace ?? ""} ${row.origin_ref ?? ""} ${row.tags?.join(" ") ?? ""}`;
}

function matchesInventorySearch(
  rows: LibraryInventoryRow[],
  search: string,
): LibraryInventoryRow[] {
  const parsed = parseListSearchQuery(search);
  if (parsed.raw.length === 0) {
    return rows;
  }

  const typePrefix = resourceTypePrefix(parsed.section);
  const textQuery =
    typePrefix !== undefined
      ? { ...parsed, section: typePrefix }
      : parsed.section !== undefined
        ? { section: undefined, text: parsed.raw, raw: parsed.raw }
        : parsed;

  const duplicateNames = duplicatePluginNames(rows);

  return rows.filter((row) => {
    if (typePrefix !== undefined && !rowMatchesTypePrefix(row, typePrefix)) {
      return false;
    }
    return matchesListSearchQuery(rowSearchHaystack(row, duplicateNames), textQuery);
  });
}

function countByFilterType(rows: LibraryInventoryRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = inventoryFilterType(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function sortInventoryRows(rows: LibraryInventoryRow[]): LibraryInventoryRow[] {
  const duplicateNames = duplicatePluginNames(rows);
  const groups = new Map<string, LibraryInventoryRow[]>();
  for (const row of rows) {
    const key = inventoryFilterType(row);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      groups.set(key, [row]);
    }
  }
  const sorted: LibraryInventoryRow[] = [];
  for (const [, groupRows] of [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    groupRows.sort((left, right) =>
      displayName(left, duplicateNames).localeCompare(displayName(right, duplicateNames)),
    );
    sorted.push(...groupRows);
  }
  return sorted;
}

function buildInventoryRows(): LibraryInventoryRow[] {
  const resourceRows = listResources().map(resourceToInventoryRow);
  const packageRows = listPlugins()
    .filter((plugin) => !isFrozenPlugin(plugin))
    .map(pluginToInventoryRow);
  return [...resourceRows, ...packageRows];
}

export type QueryLibraryInventoryInput = {
  q: string;
  type: string | null;
  limit?: number;
  offset?: number;
};

export type QueryLibraryInventoryResult = {
  rows: LibraryInventoryRow[];
  total: number;
  type_counts: Record<string, number>;
};

export function queryLibraryInventory(
  input: QueryLibraryInventoryInput,
): QueryLibraryInventoryResult {
  const allRows = buildInventoryRows();
  const searched = matchesInventorySearch(allRows, input.q);
  const type_counts = countByFilterType(searched);

  const typeFiltered =
    input.type === null
      ? searched
      : searched.filter((row) => inventoryFilterType(row) === input.type);

  const ordered = sortInventoryRows(typeFiltered);
  const total = ordered.length;
  const offset = input.offset ?? 0;
  const rows =
    input.limit === undefined
      ? ordered.slice(offset)
      : ordered.slice(offset, offset + input.limit);

  return { rows, total, type_counts };
}
