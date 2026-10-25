import type { PluginMarketplaceEntry } from "./types";

const STORAGE_KEY = "ht.desktop.discover.marketplaces.v1";

/**
 * Last marketplace list the agent returned. When the list call fails, Discover keeps
 * these sources in the sidebar (with a warning) instead of dropping the section.
 */
export function readCachedMarketplaces(): PluginMarketplaceEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry): entry is PluginMarketplaceEntry =>
        typeof entry === "object"
        && entry !== null
        && typeof (entry as { name?: unknown }).name === "string"
        && typeof (entry as { url?: unknown }).url === "string"
        && Array.isArray((entry as { platforms?: unknown }).platforms),
    );
  } catch {
    return [];
  }
}

export function writeCachedMarketplaces(entries: readonly PluginMarketplaceEntry[]): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or unavailable: the cache is only a fallback.
  }
}
