import type { CatalogPlugin } from "../services/catalog-types.js";
import { formatPublishedSelector } from "../services/plugin-selector.js";
import * as format from "./format.js";
import { renderPanel } from "./panel.js";
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

export type CatalogListRow = CatalogPlugin & {
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
  activePluginKey?: string;
};

function toRows(plugins: CatalogPlugin[]): CatalogListRow[] {
  return plugins.map((library) => {
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
      header: "ORG/CATALOG/PLUGIN",
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

export function formatCatalogSelectionLabel(library: CatalogPlugin): string {
  return `${library.orgSlug}/${library.catalogSlug}/${library.slug}`;
}

export function formatCatalogScopePath(
  library: Pick<CatalogPlugin, "orgSlug" | "catalogSlug">,
): string {
  return `${library.orgSlug}/${library.catalogSlug}`;
}

export function catalogPluginKey(library: Pick<CatalogPlugin, "orgSlug" | "catalogSlug" | "slug">): string {
  return `${library.orgSlug}/${library.catalogSlug}/${library.slug}`;
}

export function toCatalogSearchRows(
  plugins: CatalogPlugin[],
  checkedKeys: ReadonlySet<string>,
): CatalogSearchRow[] {
  return toRows(plugins).map((row) => ({
    ...row,
    checked: checkedKeys.has(catalogPluginKey(row)),
  }));
}

function decorateCatalogSearchRows(
  rows: CatalogSearchRow[],
  opts: CatalogSearchRenderOptions,
): CatalogSearchRow[] {
  return rows.map((row) => {
    const checkbox = row.checked ? "[x]" : "[ ]";
    const cursor = catalogPluginKey(row) === opts.activePluginKey ? ">" : " ";
    return {
      ...row,
      list_display_name: `${cursor}${checkbox} ${row.list_display_name}`,
    };
  });
}

function formatCatalogPluginShowLabel(plugin: CatalogPlugin): string {
  const selector = catalogPluginKey(plugin);
  return plugin.latestVersion ? `${selector}@${plugin.latestVersion}` : selector;
}

export function renderCatalogPluginShow(plugin: CatalogPlugin): string {
  return renderPanel({
    title: ["PLUGIN", formatCatalogPluginShowLabel(plugin)],
    rows: [
      ["Description", plugin.summary || "—"],
      ["Tags", plugin.tags.length > 0 ? plugin.tags.join(", ") : "—"],
      [
        "Updated",
        plugin.updatedAt
          ? format.formatRelativeTimeWithAbsolute(plugin.updatedAt)
          : "—",
      ],
    ],
  });
}

export function renderCatalogListChunk(chunk: {
  sourceLabel: string;
  plugins: CatalogPlugin[];
  pageIndex: number;
}): string {
  if (chunk.plugins.length === 0) {
    return "";
  }

  const heading = chunk.pageIndex > 0
    ? `Remote catalog · ${chunk.sourceLabel} (continued)`
    : `Remote catalog · ${chunk.sourceLabel}`;

  return [
    renderSubheader(heading),
    renderCatalogListTable(chunk.plugins),
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
  plugins: CatalogPlugin[],
  opts: CatalogListViewportOptions,
): string {
  const rows = toRows(plugins);
  if (rows.length === 0) {
    return theme.muted("No matching plugins.");
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
      summary: `${rows.length} plugins`,
      ...catalogTableLayout(opts.maxWidth),
    }),
    hints,
  ].filter(Boolean).join("\n");
}

export function renderCatalogSearchViewport(
  plugins: CatalogPlugin[],
  checkedKeys: ReadonlySet<string>,
  opts: CatalogSearchViewportOptions,
): string {
  const baseRows = toCatalogSearchRows(plugins, checkedKeys);
  if (baseRows.length === 0) {
    return theme.muted("No matching plugins.");
  }

  const activeIndex = Math.max(0, Math.min(opts.activeIndex, baseRows.length - 1));
  const activeKey = baseRows[activeIndex] ? catalogPluginKey(baseRows[activeIndex]) : undefined;
  const maxVisibleRows = computeMaxVisibleTableRows(
    opts.terminalRows,
    VIEWPORT_CHROME_LINES.catalogSearch,
  );
  const viewport = resolveSectionViewport(baseRows.length, activeIndex, maxVisibleRows);
  const visibleRows = decorateCatalogSearchRows(
    baseRows.slice(viewport.start, viewport.end),
    { activePluginKey: activeKey },
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
      summary: `${checkedCount} selected • ${baseRows.length} plugins`,
      ...catalogTableLayout(opts.maxWidth),
    }),
    hints,
  ].filter(Boolean).join("\n");
}

export function renderCatalogListTable(
  plugins: CatalogPlugin[],
  opts: CatalogListRenderOptions = {},
): string {
  const rows = toRows(plugins).map((row) => {
    const isSelected = opts.selectedSelector === row.selector
      || opts.selectedSelector === row.list_display_name;
    return {
      ...row,
      list_display_name: isSelected ? `> ${row.list_display_name}` : row.list_display_name,
    };
  });

  if (rows.length === 0) {
    return theme.muted("No matching plugins.");
  }

  return renderTable({
    columns: makeColumns(Boolean(opts.selectedSelector)),
    rows,
    summary: `${rows.length} plugins`,
  });
}

export function renderCatalogSearchTable(
  plugins: CatalogPlugin[],
  checkedKeys: ReadonlySet<string>,
  opts: CatalogSearchRenderOptions = {},
): string {
  const rows = decorateCatalogSearchRows(toCatalogSearchRows(plugins, checkedKeys), opts);
  if (rows.length === 0) {
    return theme.muted("No matching plugins.");
  }

  const checkedCount = rows.filter((row) => row.checked).length;
  return renderTable({
    columns: makeColumns(true),
    rows,
    summary: `${checkedCount} selected • ${rows.length} plugins`,
  });
}
