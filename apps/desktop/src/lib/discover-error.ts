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
