import type { Resource, ResourceType } from "../types.js";
import { RESOURCE_TYPES } from "../types.js";
import * as format from "./format.js";
import { renderTable, type Column } from "./table.js";
import { theme } from "./theme.js";

export type ResourceListRow = Resource & {
  namespace: string;
  display_name: string;
};

function makeIdColumn(showId: boolean, width = 12): Column[] {
  return showId
    ? [{
        key: "id",
        header: "ID",
        width,
        transform: (value: string) => format.shortenId(String(value)),
      }]
    : [];
}

function makeResourceTypeColumn(width = 14): Column {
  return {
    key: "type",
    header: "TYPE",
    width,
    style: (value) => theme.resourceType(value),
  };
}

function makeResourceListColumns(
  showId: boolean,
  showType: boolean,
  hasNamespace: boolean,
): Column[] {
  return [
    ...makeIdColumn(showId),
    ...(showType ? [makeResourceTypeColumn()] : []),
    { key: "display_name", header: "NAME", width: 28 },
    ...(hasNamespace
      ? [{ key: "namespace", header: "NAMESPACE", width: 20 } as const]
      : []),
    {
      key: "updated_at",
      header: "UPDATED",
      width: 16,
      transform: (value) => format.formatRelativeTime(String(value)),
    },
  ];
}

export function toResourceListRows(resources: Resource[]): ResourceListRow[] {
  return resources.map((resource) => ({
    ...resource,
    namespace: resource.namespace ?? "",
    display_name: resource.namespace
      ? `${resource.name}@${resource.namespace}`
      : resource.name,
  }));
}

export function sortResourcesByUpdatedAt<T extends Pick<Resource, "updated_at">>(
  resources: T[],
): T[] {
  return [...resources].sort(
    (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at),
  );
}

export function filterResourcesBySearch(
  resources: ResourceListRow[],
  search: string,
): ResourceListRow[] {
  const normalizedSearch = search.trim().toLowerCase();
  if (normalizedSearch.length === 0) {
    return resources;
  }

  return resources.filter((resource) =>
    `${resource.name} ${resource.description ?? ""}`
      .toLowerCase()
      .includes(normalizedSearch),
  );
}

function renderResourceTypeSubheader(type: ResourceType, count: number): string {
  return `${theme.resourceType(type)} ${theme.muted(`(${count})`)}`;
}

export function renderGroupedResourceListTables(
  resources: ResourceListRow[],
  opts: { showId: boolean },
): string {
  if (resources.length === 0) {
    return "No resources found.";
  }

  const hasNamespace = resources.some((resource) => resource.namespace.length > 0);
  const columns = makeResourceListColumns(opts.showId, false, hasNamespace);
  const lines: string[] = [];
  let wroteSection = false;

  for (const type of RESOURCE_TYPES) {
    const rows = sortResourcesByUpdatedAt(
      resources.filter((resource) => resource.type === type),
    );
    if (rows.length === 0) {
      continue;
    }
    if (wroteSection) {
      lines.push("");
    }
    wroteSection = true;
    lines.push(renderResourceTypeSubheader(type, rows.length));
    lines.push(renderTable({ columns, rows }));
  }

  lines.push("");
  lines.push(theme.info(`${resources.length} resources`));
  return lines.join("\n");
}

export function renderFlatResourceListTable(
  resources: ResourceListRow[],
  opts: { showId: boolean },
): string {
  if (resources.length === 0) {
    return "No resources found.";
  }

  const hasNamespace = resources.some((resource) => resource.namespace.length > 0);
  const rows = sortResourcesByUpdatedAt(resources);
  const table = renderTable({
    columns: makeResourceListColumns(opts.showId, false, hasNamespace),
    rows,
    summary: `${rows.length} resources`,
  });
  return table;
}
