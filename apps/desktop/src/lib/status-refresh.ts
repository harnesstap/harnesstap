/** Tooltip while a stale status is on screen and a fresh read is running. */
export function statusRefreshingTooltip(tooltip: string, refreshing: boolean): string {
  if (!refreshing) return tooltip;
  const trimmed = tooltip.trim();
  if (!trimmed) return "Refreshing.";
  return trimmed.endsWith(".") ? `${trimmed} Refreshing.` : `${trimmed}. Refreshing.`;
}
