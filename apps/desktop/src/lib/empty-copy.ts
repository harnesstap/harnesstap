export function noResultsTitle(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return "No results";
  }
  return `No results for "${trimmed}"`;
}

export type DiscoverEmptyAction = "clear-search" | null;

export function discoverEmptyKind(input: { query: string }): DiscoverEmptyAction {
  if (input.query.trim().length > 0) {
    return "clear-search";
  }
  return null;
}
