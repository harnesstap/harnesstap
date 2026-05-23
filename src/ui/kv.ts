import { theme } from "./theme.js";

export function renderKv(key: string, value: string, keyWidth = 20): string {
  return `  ${theme.muted(key.padEnd(keyWidth))}  ${value}`;
}
