export const UNTRACKED_RESOURCE_ID_PREFIX = "untracked:";

export function isUntrackedResourceSelector(selector: string): boolean {
  return selector.trim().startsWith(UNTRACKED_RESOURCE_ID_PREFIX);
}

export function parseUntrackedResourceSelector(
  selector: string,
): { type: string; name: string } | null {
  const trimmed = selector.trim();
  if (!trimmed.startsWith(UNTRACKED_RESOURCE_ID_PREFIX)) {
    return null;
  }
  const rest = trimmed.slice(UNTRACKED_RESOURCE_ID_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator <= 0 || separator === rest.length - 1) {
    return null;
  }
  return {
    type: rest.slice(0, separator),
    name: rest.slice(separator + 1),
  };
}
