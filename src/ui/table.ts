import Table from "cli-table3";
import { getTableChars, theme } from "./theme.js";

export interface Column {
  key: string;
  header: string;
  width: number;
  /** Fraction of available width when maxWidth is set (0–1). */
  widthShare?: number;
  /** When false, hyphenated tokens may break mid-token during word wrap. */
  wrapOnWordBoundary?: boolean;
  /** Transform the raw value before display (affects content and width measurement). */
  transform?: (value: string) => string;
  /** Apply styling (e.g. ANSI colour) to the displayed value without affecting width. */
  style?: (value: string) => string;
}

export interface TableOptions {
  columns: Column[];
  // biome-ignore lint/suspicious/noExplicitAny: table rows accept any typed record
  rows: Record<string, any>[];
  summary?: string;
  /** Message to show when rows is empty (instead of an empty table). */
  empty?: string;
  /** Cap total table width (including borders) to this value. */
  maxWidth?: number;
  /** Enable cli-table3 word wrap for fixed-width columns. */
  wordWrap?: boolean;
  /** Default wrapOnWordBoundary for all columns (overridden per column). */
  wrapOnWordBoundary?: boolean;
}

function contentWidth(col: Column, rows: Record<string, unknown>[]): number {
  return Math.max(
    col.width,
    col.header.length,
    ...rows.map((row) => {
      const raw = String(row[col.key] ?? "");
      const transformed = col.transform ? col.transform(raw) : raw;
      return transformed.length;
    }),
  );
}

function tableBorderOverhead(columnCount: number): number {
  return columnCount + 1;
}

export function computeColumnWidths(
  columns: Column[],
  // biome-ignore lint/suspicious/noExplicitAny: table rows accept any typed record
  rows: Record<string, any>[],
  maxWidth?: number,
): number[] {
  const contentWidths = columns.map((col) => contentWidth(col, rows) + 2);

  if (maxWidth === undefined) {
    return contentWidths;
  }

  const overhead = tableBorderOverhead(columns.length);
  const hasWidthShare = columns.some((col) => col.widthShare !== undefined);

  if (hasWidthShare) {
    const available = maxWidth - overhead;
    const shares = columns.map((col) => col.widthShare ?? 0);
    const widths = shares.map((share) => Math.floor(available * share));
    const allocated = widths.reduce((sum, width) => sum + width, 0);
    widths[0] += available - allocated;
    return widths;
  }

  const total = contentWidths.reduce((sum, width) => sum + width, 0) + overhead;
  if (total <= maxWidth) {
    return contentWidths;
  }

  const available = maxWidth - overhead;
  const minWidths = columns.map((col, index) =>
    Math.min(col.width + 2, contentWidths[index]),
  );
  const minTotal = minWidths.reduce((sum, width) => sum + width, 0);

  if (minTotal >= available) {
    let remaining = available;
    return minWidths.map((width, index) => {
      if (index === minWidths.length - 1) {
        return remaining;
      }
      const capped = Math.min(width, remaining);
      remaining -= capped;
      return capped;
    });
  }

  const extra = contentWidths.map((width, index) => width - minWidths[index]);
  const extraTotal = extra.reduce((sum, width) => sum + width, 0);
  const budget = available - minTotal;

  const widths = minWidths.map((min, index) => {
    if (extraTotal === 0) {
      return min;
    }
    return min + Math.floor((budget * extra[index]) / extraTotal);
  });

  let allocated = widths.reduce((sum, width) => sum + width, 0);
  widths[0] += available - allocated;
  return widths;
}

export function renderTable({
  columns,
  rows,
  summary,
  empty,
  maxWidth,
  wordWrap,
  wrapOnWordBoundary,
}: TableOptions): string {
  if (rows.length === 0 && empty) {
    return empty;
  }

  const colWidths =
    maxWidth !== undefined
      ? computeColumnWidths(columns, rows, maxWidth)
      : computeColumnWidths(columns, rows);

  const t = new Table({
    head: columns.map((col) => theme.heading(col.header)),
    colWidths,
    chars: getTableChars(),
    style: { head: [], border: [] },
    ...(wordWrap !== undefined ? { wordWrap } : {}),
    ...(wrapOnWordBoundary !== undefined ? { wrapOnWordBoundary } : {}),
  });

  for (const row of rows) {
    t.push(
      columns.map((col) => {
        const raw = String(row[col.key] ?? "");
        const transformed = col.transform ? col.transform(raw) : raw;
        const content = col.style ? col.style(transformed) : transformed;

        if (col.wrapOnWordBoundary === false) {
          return { content, wrapOnWordBoundary: false };
        }

        return content;
      }),
    );
  }

  const lines = [t.toString()];

  if (summary) {
    lines.push("");
    lines.push(theme.info(summary));
  }

  return lines.join("\n");
}

export const table = {
  render: renderTable,
  print: (opts: TableOptions) => console.log(renderTable(opts)),
};
