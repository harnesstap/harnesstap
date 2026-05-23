import { terminalColumns, theme } from "./theme.js";

export function header(title: string): void {
  console.log(theme.primary(title));
}

export function subheader(title: string): void {
  console.log(theme.muted(title));
}

export function rule(): void {
  const width = terminalColumns();
  console.log(theme.muted("─".repeat(width)));
}
