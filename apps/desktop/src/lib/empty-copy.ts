export function noResultsTitle(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return "No results";
  }
  return `No results for "${trimmed}"`;
}

export type DiscoverEmptyAction = "clear-search" | "show-library" | null;

export function discoverEmptyKind(input: {
  query: string;
  showInLibrary: boolean;
}): DiscoverEmptyAction {
  if (input.query.trim().length > 0) {
    return "clear-search";
  }
  if (!input.showInLibrary) {
    return "show-library";
  }
  return null;
}
