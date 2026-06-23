import type { CatalogLayer } from "../services/catalog-types.js";
import { formatPublishedSelector } from "../services/layer-selector.js";
import * as format from "./format.js";
import {
  computeMaxVisibleTableRows,
  renderFoldedHintLine,
  resolveSectionViewport,
  type SectionViewport,
  VIEWPORT_CHROME_LINES,
} from "./list-viewport.js";
import { renderSubheader } from "./section.js";
import { renderTable, type Column } from "./table.js";
import { terminalColumns, theme } from "./theme.js";

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
): CatalogSearchRow[] {
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

export function renderCatalogListChunk(chunk: {
  sourceLabel: string;
  layers: CatalogLayer[];
  pageIndex: number;
}): string {
  if (chunk.layers.length === 0) {
    return "";
  }

  const heading = chunk.pageIndex > 0
    ? `Remote catalog · ${chunk.sourceLabel} (continued)`
    : `Remote catalog · ${chunk.sourceLabel}`;

  return [
    renderSubheader(heading),
    renderCatalogListTable(chunk.layers),
  ].join("\n");
}

export type CatalogListViewportOptions = CatalogListRenderOptions & {
  activeIndex: number;
  terminalRows: number;
  maxWidth?: number;
};

export type CatalogSearchViewportOptions = CatalogSearchRenderOptions & {
  activeIndex: number;
  terminalRows: number;
  maxWidth?: number;
};

function catalogTableLayout(maxWidth?: number): {
  maxWidth: number;
  wordWrap: true;
} {
  return {
    maxWidth: maxWidth ?? terminalColumns(),
    wordWrap: true,
  };
}

function buildCatalogViewportHintSegments(
  viewport: SectionViewport,
  totalLength: number,
): string[] {
  const segments: string[] = [];
  const hiddenAbove = viewport.start;
  const hiddenBelow = totalLength - viewport.end;
  if (hiddenAbove > 0) {
    segments.push(`↑ ${hiddenAbove} above`);
  }
  if (hiddenBelow > 0) {
    segments.push(`↓ ${hiddenBelow} more`);
  }
  return segments;
}

function renderCatalogViewportOverflowHints(
  viewport: SectionViewport,
  totalLength: number,
  maxWidth: number,
): string {
  const folded = renderFoldedHintLine(
    buildCatalogViewportHintSegments(viewport, totalLength),
    maxWidth,
  );
  return folded.length > 0 ? theme.muted(folded) : "";
}

export function renderCatalogListViewport(
  layers: CatalogLayer[],
  opts: CatalogListViewportOptions,
): string {
  const rows = toRows(layers);
  if (rows.length === 0) {
    return theme.muted("No matching layers.");
  }

  const activeIndex = Math.max(0, Math.min(opts.activeIndex, rows.length - 1));
  const selectedId = rows[activeIndex]?.list_display_name;
  const maxVisibleRows = computeMaxVisibleTableRows(
    opts.terminalRows,
    VIEWPORT_CHROME_LINES.catalogBrowse,
  );
  const viewport = resolveSectionViewport(rows.length, activeIndex, maxVisibleRows);
  const visibleRows = rows.slice(viewport.start, viewport.end).map((row) => {
    const isSelected = row.list_display_name === selectedId;
    return {
      ...row,
      list_display_name: isSelected ? `> ${row.list_display_name}` : row.list_display_name,
    };
  });

  const hints = renderCatalogViewportOverflowHints(
    viewport,
    rows.length,
    opts.maxWidth ?? terminalColumns(),
  );

  return [
    renderTable({
      columns: makeColumns(true),
      rows: visibleRows,
      summary: `${rows.length} layers`,
      ...catalogTableLayout(opts.maxWidth),
    }),
    hints,
  ].filter(Boolean).join("\n");
}

export function renderCatalogSearchViewport(
  layers: CatalogLayer[],
  checkedKeys: ReadonlySet<string>,
  opts: CatalogSearchViewportOptions,
): string {
  const baseRows = toCatalogSearchRows(layers, checkedKeys);
  if (baseRows.length === 0) {
    return theme.muted("No matching layers.");
  }

  const activeIndex = Math.max(0, Math.min(opts.activeIndex, baseRows.length - 1));
  const activeKey = baseRows[activeIndex] ? catalogLayerKey(baseRows[activeIndex]) : undefined;
  const maxVisibleRows = computeMaxVisibleTableRows(
    opts.terminalRows,
    VIEWPORT_CHROME_LINES.catalogSearch,
  );
  const viewport = resolveSectionViewport(baseRows.length, activeIndex, maxVisibleRows);
  const visibleRows = decorateCatalogSearchRows(
    baseRows.slice(viewport.start, viewport.end),
    { activeLayerKey: activeKey },
  );
  const checkedCount = baseRows.filter((row) => row.checked).length;
  const hints = renderCatalogViewportOverflowHints(
    viewport,
    baseRows.length,
    opts.maxWidth ?? terminalColumns(),
  );

  return [
    renderTable({
      columns: makeColumns(true),
      rows: visibleRows,
      summary: `${checkedCount} selected • ${baseRows.length} layers`,
      ...catalogTableLayout(opts.maxWidth),
    }),
    hints,
  ].filter(Boolean).join("\n");
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
