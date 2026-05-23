import Table from "cli-table3";
import { getTableChars, theme } from "./theme.js";

export interface Column {
  key: string;
  header: string;
  width: number;
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
}

export function renderTable({ columns, rows, summary, empty }: TableOptions): string {
  if (rows.length === 0 && empty) {
    return empty;
  }

  const colWidths = columns.map((col) => {
    const maxContent = Math.max(
      col.width,
      col.header.length,
      ...rows.map((row) => {
        const raw = String(row[col.key] ?? "");
        const transformed = col.transform ? col.transform(raw) : raw;
        return transformed.length;
      }),
    );
    return maxContent + 2;
  });

  const t = new Table({
    head: columns.map((col) => col.header),
    colWidths,
    chars: getTableChars(),
    style: { head: [], border: [] },
  });

  for (const row of rows) {
    t.push(
      columns.map((col) => {
        const raw = String(row[col.key] ?? "");
        const transformed = col.transform ? col.transform(raw) : raw;
        return col.style ? col.style(transformed) : transformed;
      }),
    );
  }

  const lines = [t.toString()];

  if (summary) {
    lines.push("");
    lines.push(theme.muted(summary));
  }

  return lines.join("\n");
}

export const table = {
  render: renderTable,
  print: (opts: TableOptions) => console.log(renderTable(opts)),
};
