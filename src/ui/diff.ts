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

export interface ChangeEntry {
  kind: "added" | "removed" | "modified";
  scope: string;
  key: string;
  detail: string;
}

export function renderChangeList(changes: ChangeEntry[]): string {
  return changes
    .map((change) => {
      const glyph =
        change.kind === "added"
          ? icons.added
          : change.kind === "removed"
            ? icons.removed
            : icons.modified;
      const style =
        change.kind === "added"
          ? theme.success
          : change.kind === "removed"
            ? theme.danger
            : theme.warn;
      return `  ${style(glyph)} ${change.scope.padEnd(10)} ${change.key.padEnd(28)} ${change.detail}`;
    })
    .join("\n");
}
