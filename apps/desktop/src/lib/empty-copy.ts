export function noResultsTitle(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return "No results";
  }
  return `No results for "${trimmed}"`;
}

export type CatalogListEmptyKind = "none" | "catalog-empty" | "filter-empty";

/**
 * Filter-miss copy is only for an active filter that hid rows.
 * An unfiltered catalog with All = 0 is a real empty, not a miss.
 */
export function catalogListEmptyKind(input: {
  unfilteredCount: number;
  visibleCount: number;
  filterActive: boolean;
}): CatalogListEmptyKind {
  if (input.visibleCount > 0) {
    return "none";
  }
  if (input.unfilteredCount === 0 || !input.filterActive) {
    return "catalog-empty";
  }
  return "filter-empty";
}

export type DiscoverEmptyAction = "clear-search" | null;

export function discoverEmptyKind(input: { query: string }): DiscoverEmptyAction {
  if (input.query.trim().length > 0) {
    return "clear-search";
  }
  return null;
}
