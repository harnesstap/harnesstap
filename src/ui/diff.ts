import { icons, theme } from "./theme.js";

export interface DiffRow {
  key: string;
  before: string;
  after: string;
}

export interface DiffTableOptions {
  rows: DiffRow[];
  title?: string;
}

export function renderDiffTable({ rows, title }: DiffTableOptions): string {
  const lines: string[] = [];
  if (title) {
    lines.push(theme.primary(title));
  }
  for (const row of rows) {
    lines.push(`  ${theme.muted(row.key)}`);
    lines.push(`    ${theme.danger(`${icons.removed} ${row.before}`)}`);
    lines.push(`    ${theme.success(`${icons.added} ${row.after}`)}`);
  }
  return lines.join("\n");
}

export const diffTable = {
  render: renderDiffTable,
  print: (opts: DiffTableOptions) => console.log(renderDiffTable(opts)),
};
