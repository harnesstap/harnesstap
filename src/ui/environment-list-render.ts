import { renderPanel } from "./panel.js";
import type { Environment } from "../types.js";
import {
  computeMaxVisibleTableRows,
  renderFoldedHintLine,
  resolveSectionViewport,
  VIEWPORT_CHROME_LINES,
  type SectionViewport,
} from "./list-viewport.js";
import { matchesListSearchQuery, parseListSearchQuery } from "./list-search.js";
import { renderTable, type Column } from "./table.js";
import { terminalColumns, theme } from "./theme.js";

export type EnvironmentListRow = {
  environment: Environment;
  value_count: number;
  secret_ref_count: number;
  reference_count: number;
};

const ENVIRONMENT_SEARCH_SECTIONS = ["name", "desc", "description"] as const;
type EnvironmentSearchSection = (typeof ENVIRONMENT_SEARCH_SECTIONS)[number];

function isEnvironmentSearchSection(section: string): section is EnvironmentSearchSection {
  return (ENVIRONMENT_SEARCH_SECTIONS as readonly string[]).includes(section);
}

export function formatEnvironmentListName(
  row: EnvironmentListRow,
  opts?: { selected?: boolean },
): string {
  const cursor = opts?.selected ? ">" : " ";
  return `${cursor} ${row.environment.name}`;
}

export function filterEnvironmentsBySearch(
  rows: EnvironmentListRow[],
  search: string,
): EnvironmentListRow[] {
  const parsed = parseListSearchQuery(search);
  if (parsed.raw.length === 0) {
    return rows;
  }

  const sectionIsKnown =
    parsed.section !== undefined && isEnvironmentSearchSection(parsed.section);
  const textQuery = sectionIsKnown
    ? parsed
    : parsed.section !== undefined
      ? { section: undefined, text: parsed.raw, raw: parsed.raw }
      : parsed;

  return rows.filter((row) => {
    if (sectionIsKnown && parsed.section === "name") {
      return matchesListSearchQuery(row.environment.name, textQuery);
    }
    if (
      sectionIsKnown
      && (parsed.section === "desc" || parsed.section === "description")
    ) {
      return matchesListSearchQuery(row.environment.description, textQuery);
    }
    const haystack = `${row.environment.name} ${row.environment.description}`;
    return matchesListSearchQuery(haystack, textQuery);
  });
}

function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

function buildEnvironmentViewportHintSegments(
  viewport: SectionViewport,
  total: number,
): string[] {
  const segments: string[] = [];
  if (viewport.start > 0) {
    segments.push(`↑ ${viewport.start} above`);
  }
  if (viewport.end < total) {
    segments.push(`↓ ${total - viewport.end} more`);
  }
  return segments;
}

function renderViewportOverflowHints(
  viewport: SectionViewport,
  total: number,
  maxWidth: number,
): string {
  const folded = renderFoldedHintLine(
    buildEnvironmentViewportHintSegments(viewport, total),
    maxWidth,
  );
  return folded.length > 0 ? theme.muted(folded) : "";
}

function makeEnvironmentListColumns(highlightSelection: boolean): Column[] {
  return [
    {
      key: "name",
      header: "NAME",
      width: 24,
      style: highlightSelection
        ? (value) => (value.startsWith(">") ? theme.accent(value) : value)
        : undefined,
    },
    { key: "value_count", header: "VALUES", width: 8 },
    { key: "secret_ref_count", header: "SECRETS", width: 8 },
    { key: "reference_count", header: "REFS", width: 8 },
  ];
}

type EnvironmentTableRow = {
  name: string;
  value_count: number;
  secret_ref_count: number;
  reference_count: number;
};

function toTableRows(
  rows: EnvironmentListRow[],
  selectedName?: string,
): EnvironmentTableRow[] {
  return rows.map((row) => ({
    name: formatEnvironmentListName(row, {
      selected: row.environment.name === selectedName,
    }),
    value_count: row.value_count,
    secret_ref_count: row.secret_ref_count,
    reference_count: row.reference_count,
  }));
}

function tableLayout(maxWidth?: number): { maxWidth: number; wordWrap: true } {
  return {
    maxWidth: maxWidth ?? terminalColumns(),
    wordWrap: true,
  };
}

export type EnvironmentListViewportOptions = {
  activeIndex: number;
  navigable: EnvironmentListRow[];
  terminalRows: number;
  maxWidth?: number;
};

export function renderEnvironmentListViewport(
  opts: EnvironmentListViewportOptions,
): string {
  if (opts.navigable.length === 0) {
    return theme.muted("No environments found.");
  }

  const maxWidth = opts.maxWidth ?? terminalColumns();
  const maxVisibleRows = computeMaxVisibleTableRows(
    opts.terminalRows,
    VIEWPORT_CHROME_LINES.environmentList,
  );
  const activeIndex = clampIndex(opts.activeIndex, opts.navigable.length);
  const viewport = resolveSectionViewport(
    opts.navigable.length,
    activeIndex,
    maxVisibleRows,
  );
  const visibleRows = opts.navigable.slice(viewport.start, viewport.end);
  const selectedName = opts.navigable[activeIndex]?.environment.name;

  return [
    renderTable({
      columns: makeEnvironmentListColumns(true),
      rows: toTableRows(visibleRows, selectedName),
      ...tableLayout(opts.maxWidth),
    }),
    renderViewportOverflowHints(viewport, opts.navigable.length, maxWidth),
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function renderEnvironmentListTable(
  rows: EnvironmentListRow[],
  opts?: { maxWidth?: number },
): string {
  if (rows.length === 0) {
    return theme.muted("No environments found.");
  }

  return renderTable({
    columns: makeEnvironmentListColumns(false),
    rows: toTableRows(rows),
    ...tableLayout(opts?.maxWidth),
  });
}

export function renderEnvironmentListShow(row: EnvironmentListRow): string {
  return renderPanel({
    title: ["ENVIRONMENT", row.environment.name],
    rows: [
      ["Description", row.environment.description || "—"],
      ["Values", `${row.value_count}`],
      ["Secret refs", `${row.secret_ref_count}`],
      ["Plugin references", `${row.reference_count}`],
    ],
  });
}
