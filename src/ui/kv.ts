import { theme } from "./theme.js";

export function renderKv(key: string, value: string, keyWidth = 20, indent = 2): string {
  const spaces = " ".repeat(indent);
  return `${spaces}${theme.muted(key.padEnd(keyWidth))}  ${value}`;
}
