const CLI_CATALOG_TIMEOUT =
  "Catalog request timed out (30s). Try again, or list local plugins without --remote.";

export const DESKTOP_CATALOG_TIMEOUT = "Catalog request timed out. Try again.";

/** Discover shows Desktop copy. The CLI sentence mentions `--remote`, which Desktop does not have. */
export function desktopDiscoverError(message: string): string {
  if (message.includes(CLI_CATALOG_TIMEOUT)) {
    return DESKTOP_CATALOG_TIMEOUT;
  }
  return message;
}

/** Sidebar tooltip on a source that failed to load. The banner in the list has Retry. */
export const DISCOVER_SOURCE_ERROR_TOOLTIP = "Couldn't load. Retry to try again.";

/** Banner copy for a source Discover could not reach. The raw error goes behind Details. */
export function discoverSourceUnreachable(sourceLabel: string): string {
  return `Couldn't reach ${sourceLabel}. Check your connection, then retry.`;
}

export const DISCOVER_MARKETPLACES_UNREACHABLE =
  "Couldn't reach your marketplaces. Check your connection, then retry.";
