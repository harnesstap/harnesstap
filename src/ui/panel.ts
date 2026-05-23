import { renderKv } from "./kv.js";
import { theme } from "./theme.js";

export interface KvRow {
  key: string;
  value: string;
}

export interface PanelOptions {
  /** Title parts: first element is the section header, optional second is a subtitle. */
  title: string[];
  rows: [string, string][];
}

export function renderPanel(opts: PanelOptions): string {
  const titleStr =
    opts.title.length === 1
      ? opts.title[0] ?? ""
      : `${opts.title[0] ?? ""}  ${opts.title.slice(1).join("  ")}`;
  const lines: string[] = [theme.primary(titleStr)];
  for (const [key, value] of opts.rows) {
    lines.push(renderKv(key, value));
  }
  return lines.join("\n");
}

export function panel(opts: PanelOptions): void {
  console.log(renderPanel(opts));
}

export function kvBlock(rows: KvRow[]): void {
  for (const row of rows) {
    console.log(renderKv(row.key, row.value));
  }
}
