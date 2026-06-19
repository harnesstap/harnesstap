import type { CatalogLayer } from "../services/catalog-types.js";
import { formatPublishedSelector } from "../services/layer-selector.js";
import * as format from "./format.js";
import { renderTable, type Column } from "./table.js";
import { theme } from "./theme.js";

export type CatalogListRow = CatalogLayer & {
  selector: string;
  list_display_name: string;
};

export type CatalogListRenderOptions = {
  selectedSelector?: string;
};

export type CatalogSearchRow = CatalogListRow & {
  checked: boolean;
};

export type CatalogSearchRenderOptions = {
  activeLayerKey?: string;
};

function toRows(layers: CatalogLayer[]): CatalogListRow[] {
  return layers.map((library) => {
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

export function formatCatalogSelectionLabel(library: CatalogLayer): string {
  return `${library.orgSlug}/${library.catalogSlug}/${library.slug}`;
}

export function catalogLayerKey(library: Pick<CatalogLayer, "orgSlug" | "catalogSlug" | "slug">): string {
  return `${library.orgSlug}/${library.catalogSlug}/${library.slug}`;
}

export function toCatalogSearchRows(
  layers: CatalogLayer[],
  checkedKeys: ReadonlySet<string>,
): CatalogSearchRow[] {
  return toRows(layers).map((row) => ({
    ...row,
    checked: checkedKeys.has(catalogLayerKey(row)),
  }));
}

function decorateCatalogSearchRows(
  rows: CatalogSearchRow[],
  opts: CatalogSearchRenderOptions,
): CatalogListRow[] {
  return rows.map((row) => {
    const checkbox = row.checked ? "[x]" : "[ ]";
    const cursor = catalogLayerKey(row) === opts.activeLayerKey ? ">" : " ";
    return {
      ...row,
      list_display_name: `${cursor}${checkbox} ${row.list_display_name}`,
    };
  });
}

export function renderCatalogLayerShow(layer: CatalogLayer): string {
  const lines = [
    `${theme.accent(catalogLayerKey(layer))}`,
    `Name: ${layer.name}`,
    `Summary: ${layer.summary || theme.muted("—")}`,
    `Version: ${layer.latestVersion ?? theme.muted("—")}`,
    `Tags: ${layer.tags.length > 0 ? layer.tags.join(", ") : theme.muted("—")}`,
    `Visibility: ${layer.visibility}`,
    `Updated: ${
      layer.updatedAt
        ? format.formatRelativeTimeWithAbsolute(layer.updatedAt)
        : theme.muted("—")
    }`,
  ];
  return lines.join("\n");
}

export function renderCatalogListTable(
  layers: CatalogLayer[],
  opts: CatalogListRenderOptions = {},
): string {
  const rows = toRows(layers).map((row) => {
    const isSelected = opts.selectedSelector === row.selector
      || opts.selectedSelector === row.list_display_name;
    return {
      ...row,
      list_display_name: isSelected ? `> ${row.list_display_name}` : row.list_display_name,
    };
  });

  if (rows.length === 0) {
    return theme.muted("No matching layers.");
  }

  return renderTable({
    columns: makeColumns(Boolean(opts.selectedSelector)),
    rows,
    summary: `${rows.length} layers`,
  });
}

export function renderCatalogSearchTable(
  layers: CatalogLayer[],
  checkedKeys: ReadonlySet<string>,
  opts: CatalogSearchRenderOptions = {},
): string {
  const rows = decorateCatalogSearchRows(toCatalogSearchRows(layers, checkedKeys), opts);
  if (rows.length === 0) {
    return theme.muted("No matching layers.");
  }

  const checkedCount = rows.filter((row) => row.checked).length;
  return renderTable({
    columns: makeColumns(true),
    rows,
    summary: `${checkedCount} selected • ${rows.length} layers`,
  });
}
