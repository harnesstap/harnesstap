import { terminalColumns, theme } from "./theme.js";

export function renderHeader(title: string): string {
  return theme.primary(title);
}

export function renderSubheader(title: string): string {
  return theme.muted(title);
}

export function renderRule(): string {
  return theme.muted("─".repeat(terminalColumns()));
}

export function header(title: string): void {
  console.log(renderHeader(title));
}

export function subheader(title: string): void {
  console.log(renderSubheader(title));
}

export function rule(): void {
  console.log(renderRule());
}
