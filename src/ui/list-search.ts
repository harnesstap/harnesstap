export type ListSearchQuery = {
  section: string | undefined;
  text: string;
  raw: string;
};

export function parseListSearchQuery(input: string): ListSearchQuery {
  const trimmed = input.trim();
  const colonIndex = trimmed.indexOf(":");
  if (colonIndex <= 0) {
    return { section: undefined, text: trimmed, raw: trimmed };
  }
  const section = trimmed.slice(0, colonIndex);
  const text = trimmed.slice(colonIndex + 1);
  return { section, text, raw: trimmed };
}

export function matchesListSearchQuery(
  haystack: string,
  query: ListSearchQuery,
): boolean {
  const normalizedHaystack = haystack.toLowerCase();
  const normalizedText = query.text.trim().toLowerCase();
  if (normalizedText.length === 0) {
    return true;
  }
  return normalizedHaystack.includes(normalizedText);
}
