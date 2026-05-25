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

function renderPanelTitle(parts: string[]): string {
  const [head, ...rest] = parts;
  return rest.length === 0
    ? theme.primary(head ?? "")
    : `${theme.primary(head ?? "")}  ${rest.map((p) => theme.muted(p)).join("  ")}`;
}

export function renderPanel(opts: PanelOptions): string {
  const lines: string[] = [renderPanelTitle(opts.title)];
  for (const [key, value] of opts.rows) {
    lines.push(renderKv(key, value));
  }
  return lines.join("\n");
}

export function panel(opts: PanelOptions): void {
  console.log(renderPanel(opts));
}

export function kvBlock(rows: KvRow[], opts?: { indent?: number; keyWidth?: number }): void {
  for (const row of rows) {
    console.log(renderKv(row.key, row.value, opts?.keyWidth, opts?.indent));
  }
}
