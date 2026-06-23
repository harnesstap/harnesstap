export type SectionViewport = {
  start: number;
  end: number;
};

export const DEFAULT_SECTION_TABLE_OVERHEAD_LINES = 5;

/** cli-table3 bordered rows use a horizontal rule plus content (~2 lines each). */
export const BORDERED_TABLE_LINES_PER_ROW = 2;

export const VIEWPORT_CHROME_LINES = {
  resourceList: 6,
  catalogBrowse: 8,
  catalogSearch: 10,
  layerEdit: 7,
  environmentEdit: 6,
  layerListBrowse: 8,
} as const;

export function computeRemoteListFetchLimit(
  terminalRowCount: number,
  chromeLines: number,
  opts?: { min?: number; search?: boolean },
): number {
  const visible = computeMaxVisibleTableRows(terminalRowCount, chromeLines);
  const min = opts?.min ?? 10;
  if (opts?.search) {
    return Math.max(min, 25, visible + 5);
  }
  return Math.max(min, visible + 5);
}

export function computeMaxVisibleRows(
  terminalRowCount: number,
  chromeLines: number = VIEWPORT_CHROME_LINES.resourceList,
  sectionOverhead: number = DEFAULT_SECTION_TABLE_OVERHEAD_LINES,
): number {
  const budget = terminalRowCount - chromeLines - sectionOverhead;
  return Math.max(3, budget - 1);
}

export function computeMaxVisibleTableRows(
  terminalRowCount: number,
  chromeLines: number = VIEWPORT_CHROME_LINES.resourceList,
  opts?: {
    sectionOverhead?: number;
    linesPerRow?: number;
    wrapReservePerRow?: number;
  },
): number {
  const sectionOverhead = opts?.sectionOverhead ?? DEFAULT_SECTION_TABLE_OVERHEAD_LINES;
  const linesPerRow =
    (opts?.linesPerRow ?? BORDERED_TABLE_LINES_PER_ROW)
    + (opts?.wrapReservePerRow ?? 1);
  const bodyBudget = terminalRowCount - chromeLines - sectionOverhead;
  if (bodyBudget <= linesPerRow) {
    return 2;
  }
  return Math.max(2, Math.floor(bodyBudget / linesPerRow) - 1);
}

export function resolveSectionViewport(
  sectionLength: number,
  activeIndex: number,
  maxVisibleRows: number,
): SectionViewport {
  if (sectionLength <= maxVisibleRows) {
    return { start: 0, end: sectionLength };
  }
  const middle = Math.floor(maxVisibleRows / 2);
  let start = activeIndex - middle;
  if (start < 0) start = 0;
  if (start + maxVisibleRows > sectionLength) {
    start = sectionLength - maxVisibleRows;
  }
  return { start, end: start + maxVisibleRows };
}

export function renderFlatOverflowHints(
  viewport: SectionViewport,
  totalLength: number,
): string[] {
  const hints: string[] = [];
  if (viewport.start > 0) {
    hints.push(`  ↑ ${viewport.start} above`);
  }
  if (viewport.end < totalLength) {
    hints.push(`  ↓ ${totalLength - viewport.end} more`);
  }
  return hints;
}

const HINT_SEPARATOR = " · ";
const HINT_INDENT = "  ";

export function renderFoldedHintLine(segments: string[], maxWidth: number): string {
  if (segments.length === 0) {
    return "";
  }

  const normalizedWidth = Math.max(10, maxWidth);
  const lines: string[] = [];
  let current = HINT_INDENT;

  for (const segment of segments) {
    const piece =
      segment.length > normalizedWidth - HINT_INDENT.length
        ? `${segment.slice(0, Math.max(0, normalizedWidth - HINT_INDENT.length - 1))}…`
        : segment;

    const candidate =
      current === HINT_INDENT
        ? `${current}${piece}`
        : `${current}${HINT_SEPARATOR}${piece}`;

    if (candidate.length <= normalizedWidth) {
      current = candidate;
      continue;
    }

    if (current !== HINT_INDENT) {
      lines.push(current);
      current = `${HINT_INDENT}${piece}`;
      continue;
    }

    lines.push(candidate);
    current = HINT_INDENT;
  }

  if (current !== HINT_INDENT) {
    lines.push(current);
  }

  return lines.join("\n");
}
