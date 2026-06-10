import type { CatalogLibrary } from "../services/catalog-types.js";
import { formatPublishedSelector } from "../services/layer-selector.js";
import * as format from "./format.js";
import { renderTable, type Column } from "./table.js";
import { theme } from "./theme.js";

export type CatalogListRow = CatalogLibrary & {
  selector: string;
  list_display_name: string;
};

export type CatalogListRenderOptions = {
  selectedSelector?: string;
};

function toRows(libraries: CatalogLibrary[]): CatalogListRow[] {
  return libraries.map((library) => {
    const selector = formatPublishedSelector({
      org: library.orgSlug,
      catalog: library.catalogSlug,
      name: library.slug,
    });
    const listDisplayName = `${library.orgSlug}/${library.catalogSlug}/${library.slug}`;
    return {
      ...library,
      selector,
      list_display_name: listDisplayName,
    };
  });
}

function makeColumns(highlightSelection: boolean): Column[] {
  return [
    {
      key: "list_display_name",
      header: "ORG/CATALOG/LAYER",
      width: 40,
      style: highlightSelection
        ? (value) => (value.startsWith("> ") ? theme.accent(value) : value)
        : undefined,
    },
    {
      key: "name",
      header: "NAME",
      width: 22,
    },
    {
      key: "visibility",
      header: "VIS",
      width: 8,
      transform: (value) => String(value).slice(0, 4),
    },
    {
      key: "updatedAt",
      header: "UPDATED",
      width: 16,
      transform: (value) =>
        value ? format.formatRelativeTime(String(value)) : theme.muted("—"),
    },
  ];
}

export function formatCatalogSelectionLabel(library: CatalogLibrary): string {
  return `${library.orgSlug}/${library.catalogSlug}/${library.slug}`;
}

export function renderCatalogListTable(
  libraries: CatalogLibrary[],
  opts: CatalogListRenderOptions = {},
): string {
  const rows = toRows(libraries).map((row) => {
    const isSelected = opts.selectedSelector === row.selector
      || opts.selectedSelector === row.list_display_name;
    return {
      ...row,
      list_display_name: isSelected ? `> ${row.list_display_name}` : row.list_display_name,
    };
  });

  if (rows.length === 0) {
    return theme.muted("No matching libraries.");
  }

  return renderTable({
    columns: makeColumns(Boolean(opts.selectedSelector)),
    rows,
    summary: `${rows.length} libraries`,
  });
}
