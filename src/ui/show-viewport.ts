import { renderFoldedHintLine } from "./list-viewport.js";

/** Blank line + help line below scrollable show content. */
export const SHOW_VIEW_CHROME_LINES = 2;

export function computeShowViewportBounds(
  totalLines: number,
  scrollOffset: number,
  terminalRows: number,
  chromeLines: number = SHOW_VIEW_CHROME_LINES,
): { start: number; end: number; maxScroll: number } {
  const hintReserve = 1;
  const maxVisible = Math.max(1, terminalRows - chromeLines - hintReserve);
  const maxScroll = Math.max(0, totalLines - maxVisible);
  const clampedOffset = Math.min(scrollOffset, maxScroll);
  const start = clampedOffset;
  const end = Math.min(totalLines, start + maxVisible);
  return { start, end, maxScroll };
}

export function moveShowScrollOffset(
  current: number,
  direction: -1 | 1,
  maxScroll: number,
): number {
  return Math.min(maxScroll, Math.max(0, current + direction));
}

export function renderScrollableShowContent(
  content: string,
  scrollOffset: number,
  terminalRows: number,
  maxWidth?: number,
): string {
  const lines = content.split("\n");
  const { start, end } = computeShowViewportBounds(lines.length, scrollOffset, terminalRows);
  const visible = lines.slice(start, end);
  const hints: string[] = [];
  if (start > 0) {
    hints.push(`↑ ${start} above`);
  }
  if (end < lines.length) {
    hints.push(`↓ ${lines.length - end} below`);
  }

  if (hints.length === 0) {
    return visible.join("\n");
  }

  const hintLine = maxWidth !== undefined
    ? renderFoldedHintLine(hints, maxWidth)
    : `  ${hints.join(" · ")}`;
  return [...visible, "", hintLine].join("\n");
}
