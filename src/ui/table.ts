import Table from "cli-table3";
import { getTableChars, theme } from "./theme.js";

export interface Column {
  key: string;
  header: string;
  width: number;
}

export interface TableOptions {
  columns: Column[];
  rows: Record<string, string>[];
  summary?: string;
}

export function renderTable({ columns, rows, summary }: TableOptions): string {
  const colWidths = columns.map((col) => {
    const maxContent = Math.max(
      col.width,
      col.header.length,
      ...rows.map((row) => (row[col.key] ?? "").length),
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
    t.push(columns.map((col) => row[col.key] ?? ""));
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
