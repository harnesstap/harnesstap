import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface RefreshCacheEntry {
  lastRefreshedAt: string;
}

export interface RefreshCacheFile {
  sources: Record<string, RefreshCacheEntry>;
}

const EMPTY_CACHE: RefreshCacheFile = { sources: {} };

export function loadRefreshCache(harnesstapDir: string): RefreshCacheFile {
  const path = join(harnesstapDir, "plugin-refresh-cache.json");
  if (!existsSync(path)) return { ...EMPTY_CACHE };
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<RefreshCacheFile>;
    return { sources: raw.sources ?? {} };
  } catch {
    return { ...EMPTY_CACHE };
  }
}

export function saveRefreshCache(
  harnesstapDir: string,
  cache: RefreshCacheFile,
): void {
  mkdirSync(harnesstapDir, { recursive: true });
  const path = join(harnesstapDir, "plugin-refresh-cache.json");
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, "utf-8");
}

export function markSourceRefreshed(
  cache: RefreshCacheFile,
  sourceKey: string,
  at: Date = new Date(),
): RefreshCacheFile {
  return {
    sources: {
      ...cache.sources,
      [sourceKey]: { lastRefreshedAt: at.toISOString() },
    },
  };
}

export function isSourceStale(
  cache: RefreshCacheFile,
  sourceKey: string,
  maxAgeHours: number,
  now: Date = new Date(),
): boolean {
  const entry = cache.sources[sourceKey];
  if (!entry?.lastRefreshedAt) return true;
  const refreshed = new Date(entry.lastRefreshedAt);
  const ageMs = now.getTime() - refreshed.getTime();
  return ageMs > maxAgeHours * 60 * 60 * 1000;
}

export function getSourcesToRefresh(
  sourceKeys: string[],
  cache: RefreshCacheFile,
  maxAgeHours: number,
  forceRefresh: boolean,
  now: Date = new Date(),
): string[] {
  if (forceRefresh) return [...sourceKeys];
  return sourceKeys.filter((key) => isSourceStale(cache, key, maxAgeHours, now));
}
