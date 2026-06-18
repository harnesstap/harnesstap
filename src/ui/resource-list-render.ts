import type { Resource, ResourceType } from "../types.js";
import { RESOURCE_TYPES } from "../types.js";
import * as format from "./format.js";
import { renderTable, type Column } from "./table.js";
import { theme } from "./theme.js";

export const DEFAULT_RESOURCE_LIST_PER_TYPE_LIMIT = 10;

export type ResourceListRow = Resource & {
  namespace: string;
  display_name: string;
};

export type ResourceListRenderOptions = {
  showId: boolean;
  showAll?: boolean;
  perTypeLimit?: number;
  selectedResourceId?: string;
};

export type LayerEditTableRow = ResourceListRow & {
  checked: boolean;
  version_constraint?: string;
};

export type LayerEditRenderOptions = ResourceListRenderOptions & {
  activeRowId?: string;
};

type ResourceListDisplayRow = ResourceListRow & {
  list_display_name: string;
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
  highlightSelection: boolean,
): Column[] {
  return [
    ...makeIdColumn(showId),
    ...(showType ? [makeResourceTypeColumn()] : []),
    {
      key: "list_display_name",
      header: "NAME",
      width: 28,
      style: highlightSelection
        ? (value) => (value.startsWith("> ") ? theme.accent(value) : value)
        : undefined,
    },
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
    `${resource.name} ${resource.description ?? ""} ${resource.display_name}`
      .toLowerCase()
      .includes(normalizedSearch),
  );
}

export function filterLayerEditRowsBySearch(
  rows: LayerEditTableRow[],
  search: string,
): LayerEditTableRow[] {
  const normalizedSearch = search.trim().toLowerCase();
  if (normalizedSearch.length === 0) {
    return rows;
  }

  return rows.filter((row) =>
    `${row.name} ${row.description ?? ""} ${row.display_name} ${row.version_constraint ?? ""}`
      .toLowerCase()
      .includes(normalizedSearch),
  );
}

function sortLayerEditRowsForDisplay(rows: LayerEditTableRow[]): LayerEditTableRow[] {
  return [...rows].sort((left, right) => {
    if (left.checked !== right.checked) {
      return left.checked ? -1 : 1;
    }
    return Date.parse(right.updated_at) - Date.parse(left.updated_at);
  });
}

function renderResourceTypeSubheader(type: ResourceType, count: number): string {
  return `${theme.resourceType(type)} ${theme.muted(`(${count})`)}`;
}

function resolvePerTypeLimit(opts: ResourceListRenderOptions): number | undefined {
  if (opts.showAll) {
    return undefined;
  }
  return opts.perTypeLimit ?? DEFAULT_RESOURCE_LIST_PER_TYPE_LIMIT;
}

function limitRows<T extends { id: string }>(
  rows: T[],
  limit: number | undefined,
  selectedResourceId?: string,
): {
  visible: T[];
  hiddenCount: number;
} {
  if (limit === undefined || rows.length <= limit) {
    return { visible: rows, hiddenCount: 0 };
  }

  let visible = rows.slice(0, limit);
  if (
    selectedResourceId
    && !visible.some((row) => row.id === selectedResourceId)
  ) {
    const selected = rows.find((row) => row.id === selectedResourceId);
    if (selected) {
      visible = [...visible.slice(0, Math.max(0, limit - 1)), selected];
    }
  }

  const hiddenCount = rows.length - visible.length;
  return { visible, hiddenCount };
}

export function listNavigableResources(
  resources: ResourceListRow[],
  typeFilter?: ResourceType,
): ResourceListRow[] {
  if (typeFilter) {
    return sortResourcesByUpdatedAt(
      resources.filter((resource) => resource.type === typeFilter),
    );
  }

  const ordered: ResourceListRow[] = [];
  for (const type of RESOURCE_TYPES) {
    ordered.push(
      ...sortResourcesByUpdatedAt(
        resources.filter((resource) => resource.type === type),
      ),
    );
  }
  return ordered;
}

function decorateRowsForCheckboxes(
  rows: LayerEditTableRow[],
  opts: LayerEditRenderOptions,
): ResourceListDisplayRow[] {
  return rows.map((row) => {
    const checkbox = row.checked ? "[x]" : "[ ]";
    const cursor = row.id === opts.activeRowId ? ">" : " ";
    const constraint =
      row.checked && row.version_constraint
        ? ` (${row.version_constraint})`
        : "";
    return {
      ...row,
      list_display_name: `${cursor}${checkbox} ${row.display_name}${constraint}`,
    };
  });
}

export function listNavigableLayerEditRows(
  rows: LayerEditTableRow[],
  typeFilter?: ResourceType,
): LayerEditTableRow[] {
  if (typeFilter) {
    return sortLayerEditRowsForDisplay(
      rows.filter((row) => row.type === typeFilter),
    );
  }

  const ordered: LayerEditTableRow[] = [];
  for (const type of RESOURCE_TYPES) {
    ordered.push(
      ...sortLayerEditRowsForDisplay(
        rows.filter((row) => row.type === type),
      ),
    );
  }
  return ordered;
}

export function renderGroupedLayerEditTables(
  rows: LayerEditTableRow[],
  opts: LayerEditRenderOptions,
): string {
  if (rows.length === 0) {
    return "No resources found.";
  }

  const hasNamespace = rows.some((row) => row.namespace.length > 0);
  const columns = makeResourceListColumns(opts.showId, false, hasNamespace, true);
  const perTypeLimit = resolvePerTypeLimit(opts);
  const lines: string[] = [];
  let wroteSection = false;

  for (const type of RESOURCE_TYPES) {
    const typeRows = sortLayerEditRowsForDisplay(
      rows.filter((row) => row.type === type),
    );
    if (typeRows.length === 0) {
      continue;
    }
    const { visible, hiddenCount } = limitRows(
      typeRows,
      perTypeLimit,
      opts.activeRowId,
    );
    if (wroteSection) {
      lines.push("");
    }
    wroteSection = true;
    lines.push(renderResourceTypeSubheader(type, typeRows.length));
    lines.push(renderTable({
      columns,
      rows: decorateRowsForCheckboxes(visible, opts),
    }));
    if (hiddenCount > 0) {
      lines.push(renderHiddenRowsHint(hiddenCount));
    }
  }

  const checkedCount = rows.filter((row) => row.checked).length;
  lines.push("");
  lines.push(theme.info(`${checkedCount} selected • ${rows.length} resources`));
  return lines.join("\n");
}

export function renderFlatLayerEditTable(
  rows: LayerEditTableRow[],
  opts: LayerEditRenderOptions,
): string {
  if (rows.length === 0) {
    return "No resources found.";
  }

  const hasNamespace = rows.some((row) => row.namespace.length > 0);
  const sortedRows = sortLayerEditRowsForDisplay(rows);
  const perTypeLimit = resolvePerTypeLimit(opts);
  const { visible, hiddenCount } = limitRows(
    sortedRows,
    perTypeLimit,
    opts.activeRowId,
  );
  const checkedCount = rows.filter((row) => row.checked).length;
  const lines = [
    renderTable({
      columns: makeResourceListColumns(opts.showId, false, hasNamespace, true),
      rows: decorateRowsForCheckboxes(visible, opts),
      summary: `${checkedCount} selected ${theme.muted(`(${sortedRows.length} resources)`)}`,
    }),
  ];
  if (hiddenCount > 0) {
    lines.push(renderHiddenRowsHint(hiddenCount));
  }
  return lines.join("\n");
}

function decorateRowsForSelection(
  rows: ResourceListRow[],
  selectedResourceId?: string,
): ResourceListDisplayRow[] {
  return rows.map((row) => ({
    ...row,
    list_display_name: row.id === selectedResourceId
      ? `> ${row.display_name}`
      : `  ${row.display_name}`,
  }));
}

export function formatResourceSelectionLabel(resource: ResourceListRow): string {
  return `${resource.type} ${resource.display_name}`;
}

function renderHiddenRowsHint(hiddenCount: number): string {
  return theme.muted(
    `  … and ${hiddenCount} more ${hiddenCount === 1 ? "resource" : "resources"} (use --all to show all)`,
  );
}

export function renderGroupedResourceListTables(
  resources: ResourceListRow[],
  opts: ResourceListRenderOptions,
): string {
  if (resources.length === 0) {
    return "No resources found.";
  }

  const hasNamespace = resources.some((resource) => resource.namespace.length > 0);
  const highlightSelection = Boolean(opts.selectedResourceId);
  const columns = makeResourceListColumns(opts.showId, false, hasNamespace, highlightSelection);
  const perTypeLimit = resolvePerTypeLimit(opts);
  const lines: string[] = [];
  let wroteSection = false;

  for (const type of RESOURCE_TYPES) {
    const rows = sortResourcesByUpdatedAt(
      resources.filter((resource) => resource.type === type),
    );
    if (rows.length === 0) {
      continue;
    }
    const { visible, hiddenCount } = limitRows(
      rows,
      perTypeLimit,
      opts.selectedResourceId,
    );
    if (wroteSection) {
      lines.push("");
    }
    wroteSection = true;
    lines.push(renderResourceTypeSubheader(type, rows.length));
    lines.push(renderTable({
      columns,
      rows: decorateRowsForSelection(visible, opts.selectedResourceId),
    }));
    if (hiddenCount > 0) {
      lines.push(renderHiddenRowsHint(hiddenCount));
    }
  }

  lines.push("");
  lines.push(theme.info(`${resources.length} resources`));
  return lines.join("\n");
}

export function renderFlatResourceListTable(
  resources: ResourceListRow[],
  opts: ResourceListRenderOptions,
): string {
  if (resources.length === 0) {
    return "No resources found.";
  }

  const hasNamespace = resources.some((resource) => resource.namespace.length > 0);
  const sortedRows = sortResourcesByUpdatedAt(resources);
  const perTypeLimit = resolvePerTypeLimit(opts);
  const highlightSelection = Boolean(opts.selectedResourceId);
  const { visible, hiddenCount } = limitRows(
    sortedRows,
    perTypeLimit,
    opts.selectedResourceId,
  );
  const lines = [
    renderTable({
      columns: makeResourceListColumns(opts.showId, false, hasNamespace, highlightSelection),
      rows: decorateRowsForSelection(visible, opts.selectedResourceId),
      summary: `${sortedRows.length} resources`,
    }),
  ];
  if (hiddenCount > 0) {
    lines.push(renderHiddenRowsHint(hiddenCount));
  }
  return lines.join("\n");
}
