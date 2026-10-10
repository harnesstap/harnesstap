import Table from "cli-table3";
import { getTableChars, isTty, terminalColumns, theme } from "./theme.js";

/** Off-TTY default so piped output does not expand to unbounded description columns. */
export const OFF_TTY_TABLE_WIDTH = 100;

export interface Column {
  key: string;
  header: string;
  width: number;
  /** Floor used when distributing `widthShare` under `maxWidth`. */
  minWidth?: number;
  /** Fraction of available width when maxWidth is set (0–1). */
  widthShare?: number;
  /** Size to header/content and do not shrink when distributing leftover width. */
  fitContent?: boolean;
  /** Truncate with "..." instead of wrapping when the cell exceeds the column width. */
  truncate?: boolean;
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

export function resolveTableMaxWidth(explicit?: number): number {
  if (explicit !== undefined) {
    return explicit;
  }
  if (isTty() && typeof process.stdout.columns === "number" && process.stdout.columns > 0) {
    return process.stdout.columns;
  }
  if (isTty()) {
    return terminalColumns();
  }
  return OFF_TTY_TABLE_WIDTH;
}

export function truncateTableCell(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  if (value.length <= width) {
    return value;
  }
  if (width <= 3) {
    return value.slice(0, width);
  }
  return `${value.slice(0, width - 3)}...`;
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
  const available = Math.max(columns.length, maxWidth - overhead);
  const fitIndexes = columns
    .map((col, index) => (col.fitContent ? index : -1))
    .filter((index) => index >= 0);
  const flexibleIndexes = columns
    .map((col, index) => (col.fitContent ? -1 : index))
    .filter((index) => index >= 0);

  const widths = contentWidths.slice();
  if (fitIndexes.length > 0) {
    for (const index of fitIndexes) {
      widths[index] = contentWidths[index] ?? 0;
    }
  }

  const fitTotal = fitIndexes.reduce((sum, index) => sum + (widths[index] ?? 0), 0);
  const flexibleBudget = Math.max(flexibleIndexes.length, available - fitTotal);

  if (flexibleIndexes.length === 0) {
    return shrinkToAvailable(widths, columns, available);
  }

  const flexibleColumns = flexibleIndexes.map((index) => columns[index] as Column);
  const flexibleContent = flexibleIndexes.map((index) => contentWidths[index] ?? 0);
  const flexibleWidths = allocateFlexibleColumnWidths(
    flexibleColumns,
    flexibleContent,
    flexibleBudget,
  );
  flexibleIndexes.forEach((columnIndex, innerIndex) => {
    widths[columnIndex] = flexibleWidths[innerIndex] ?? widths[columnIndex] ?? 0;
  });
  return shrinkToAvailable(widths, columns, available);
}

function shrinkToAvailable(
  widths: number[],
  columns: Column[],
  available: number,
): number[] {
  let allocated = widths.reduce((sum, width) => sum + width, 0);
  if (allocated <= available) {
    return widths;
  }
  let overflow = allocated - available;
  for (let index = widths.length - 1; index >= 0 && overflow > 0; index--) {
    if (columns[index]?.fitContent) {
      continue;
    }
    const floor = columns[index]?.minWidth ?? 1;
    const reducible = Math.max(0, (widths[index] ?? 0) - floor);
    if (reducible <= 0) {
      continue;
    }
    const take = Math.min(reducible, overflow);
    widths[index] = (widths[index] ?? 0) - take;
    overflow -= take;
  }
  for (let index = widths.length - 1; index >= 0 && overflow > 0; index--) {
    const floor = 1;
    const reducible = Math.max(0, (widths[index] ?? 0) - floor);
    if (reducible <= 0) {
      continue;
    }
    const take = Math.min(reducible, overflow);
    widths[index] = (widths[index] ?? 0) - take;
    overflow -= take;
  }
  return widths;
}

function allocateFlexibleColumnWidths(
  columns: Column[],
  contentWidths: number[],
  available: number,
): number[] {
  if (columns.length === 0) {
    return [];
  }
  const hasWidthShare = columns.some((col) => col.widthShare !== undefined);

  if (hasWidthShare) {
    const floors = columns.map((col) => col.minWidth ?? 0);
    const shareSum = columns.reduce((sum, col) => sum + (col.widthShare ?? 0), 0);
    const widths = columns.map((col, index) => {
      const share = shareSum > 0 ? (col.widthShare ?? 0) / shareSum : 1 / columns.length;
      return Math.max(floors[index] ?? 0, Math.floor(available * share));
    });
    let allocated = widths.reduce((sum, width) => sum + width, 0);
    if (allocated > available) {
      let overflow = allocated - available;
      for (let index = widths.length - 1; index >= 0 && overflow > 0; index--) {
        const reducible = (widths[index] ?? 0) - (floors[index] ?? 0);
        if (reducible <= 0) {
          continue;
        }
        const take = Math.min(reducible, overflow);
        widths[index] = (widths[index] ?? 0) - take;
        overflow -= take;
      }
      allocated = widths.reduce((sum, width) => sum + width, 0);
    }
    if (widths.length > 0 && allocated < available) {
      widths[0] = (widths[0] ?? 0) + available - allocated;
    }
    return widths;
  }

  const total = contentWidths.reduce((sum, width) => sum + width, 0);
  if (total <= available) {
    return contentWidths;
  }

  const minWidths = columns.map((col, index) =>
    Math.min(col.width + 2, contentWidths[index] ?? col.width + 2),
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

  const extra = contentWidths.map((width, index) => width - (minWidths[index] ?? 0));
  const extraTotal = extra.reduce((sum, width) => sum + width, 0);
  const budget = available - minTotal;
  const widths = minWidths.map((min, index) => {
    if (extraTotal === 0) {
      return min;
    }
    return min + Math.floor((budget * (extra[index] ?? 0)) / extraTotal);
  });
  const allocated = widths.reduce((sum, width) => sum + width, 0);
  if (widths.length > 0) {
    widths[0] = (widths[0] ?? 0) + available - allocated;
  }
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

  const resolvedMaxWidth = resolveTableMaxWidth(maxWidth);
  const colWidths = computeColumnWidths(columns, rows, resolvedMaxWidth);

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
      columns.map((col, index) => {
        const raw = String(row[col.key] ?? "");
        const transformed = col.transform ? col.transform(raw) : raw;
        const innerWidth = Math.max(0, (colWidths[index] ?? col.width) - 2);
        const clipOverflow = Boolean(col.truncate) || Boolean(col.fitContent) || !wordWrap;
        const clipped = clipOverflow
          ? truncateTableCell(transformed, innerWidth)
          : transformed;
        const content = col.style ? col.style(clipped) : clipped;

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
