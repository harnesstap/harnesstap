import { theme } from "./theme.js";

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
  const lines: string[] = [];

  const headerLine = columns.map((col) => col.header.padEnd(col.width)).join("  ");
  lines.push(theme.primary(headerLine));

  for (const row of rows) {
    const rowLine = columns
      .map((col) => {
        const value = row[col.key] ?? "";
        return value.padEnd(col.width);
      })
      .join("  ");
    lines.push(rowLine);
  }

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
