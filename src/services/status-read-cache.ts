import { join } from "node:path";
import { getDbPath } from "../db/connection.js";
import {
  cursorStateDbPath,
  cursorUserDataDir,
} from "../plugins/cursor-enablement.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { getActiveProfileName } from "./active-profile.js";
import { fileSignature } from "./file-signature.js";
import { projectDriftWatchPaths } from "./global-profile-status-panel.js";

export interface StatusCacheRequest {
  depth?: string;
  harness?: string;
  projectPath?: string;
  /** When false, fast and full share one entry (the dry-run core). */
  includeDepth?: boolean;
}

interface CacheEntry<T> {
  base: string;
  watched: Array<{ path: string; sig: string }>;
  value: T;
}

const buckets = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
let generation = 0;

export function clearGlobalProfileStatusCache(): void {
  generation += 1;
  buckets.clear();
}

function baseSignature(): string {
  const home = resolveHomeRoot();
  const paths = [
    getDbPath(),
    cursorStateDbPath(home),
    join(cursorUserDataDir(home), "logs"),
    join(home, ".cursor", "plugins"),
    join(home, ".claude", "plugins", "installed_plugins.json"),
    join(home, ".cursor", "plugins", "installed.json"),
    join(home, ".cursor", "plugins", "installed_plugins.json"),
    join(cursorUserDataDir(home), "User", "settings.json"),
  ];
  return paths.map((path) => fileSignature(path)).join("|");
}

function requestKey(input: StatusCacheRequest): string {
  const profile = getActiveProfileName() ?? "";
  const depth = input.includeDepth === false ? "*" : (input.depth ?? "full");
  return [depth, input.harness ?? "", input.projectPath ?? "", profile].join("\0");
}

function watchedRows(paths: readonly string[]): Array<{ path: string; sig: string }> {
  const rows: Array<{ path: string; sig: string }> = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    rows.push({ path, sig: fileSignature(path) });
  }
  return rows;
}

function entryMatches<T>(
  entry: CacheEntry<T>,
  projectPath: string | undefined,
): boolean {
  if (entry.base !== baseSignature()) return false;
  for (const row of entry.watched) {
    if (fileSignature(row.path) !== row.sig) return false;
  }
  for (const path of projectDriftWatchPaths(projectPath)) {
    const row = entry.watched.find((item) => item.path === path);
    if (!row || fileSignature(path) !== row.sig) return false;
  }
  return true;
}

/**
 * Reuse a status computation while the library database, Cursor inputs, and
 * the files that computation compared are unchanged. Concurrent callers for
 * the same key share one in-flight load.
 */
export async function withStatusReadCache<T>(
  input: StatusCacheRequest,
  load: () => Promise<{ value: T; watchedPaths: readonly string[] }>,
): Promise<T> {
  const key = requestKey(input);
  const cached = buckets.get(key) as CacheEntry<T> | undefined;
  if (cached && entryMatches(cached, input.projectPath)) {
    return structuredClone(cached.value);
  }

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) {
    return structuredClone(await pending);
  }

  const gen = generation;
  const projectPath = input.projectPath;
  const promise = (async () => {
    const loaded = await load();
    if (gen === generation) {
      const watched = watchedRows([
        ...loaded.watchedPaths,
        ...projectDriftWatchPaths(projectPath),
      ]);
      buckets.set(key, {
        base: baseSignature(),
        watched,
        value: loaded.value,
      });
      if (buckets.size > 16) {
        const oldest = buckets.keys().next().value;
        if (oldest) buckets.delete(oldest);
      }
    }
    return loaded.value;
  })();

  inflight.set(key, promise);
  try {
    return structuredClone(await promise);
  } finally {
    if (inflight.get(key) === promise) {
      inflight.delete(key);
    }
  }
}
