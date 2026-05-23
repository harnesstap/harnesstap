import { renderKv } from "./kv.js";
import { theme } from "./theme.js";

export interface KvRow {
  key: string;
  value: string;
}

export function renderPanel(title: string, rows: KvRow[]): string {
  const lines: string[] = [theme.primary(title)];
  for (const row of rows) {
    lines.push(renderKv(row.key, row.value));
  }
  return lines.join("\n");
}

export function panel(title: string, rows: KvRow[]): void {
  console.log(renderPanel(title, rows));
}

export function kvBlock(rows: KvRow[]): void {
  for (const row of rows) {
    console.log(renderKv(row.key, row.value));
  }
}
