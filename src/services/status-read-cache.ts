import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { dirname, join } from "node:path";
import { getDbPath } from "../db/connection.js";
import { findNewestCursorPluginsLog } from "../plugins/cursor-local-plugin.js";
import {
  cursorStateDbPath,
  cursorUserDataDir,
} from "../plugins/cursor-enablement.js";
import { getAllPlatforms } from "../platforms/registry.js";
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

export interface StatusCacheLoadOptions {
  /**
   * When a cached result exists and inputs changed, return it immediately
   * with `refreshing: true` and recompute in the background. Own apply,
   * switch, and install clear the cache instead, so the next read waits.
   */
  staleWhileRefresh?: boolean;
}

interface CacheEntry<T> {
  paths: string[];
  fingerprint: string;
  /** Epoch observed when this value was stored. A newer epoch is dirty. */
  epoch: number;
  value: T;
}

const MANIFEST_RELATIVE_PATHS = [
  ".claude-plugin/marketplace.json",
  ".cursor-plugin/marketplace.json",
  ".github/plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
  "marketplace.json",
];

const buckets = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, { generation: number; promise: Promise<void> }>();
const watchers = new Map<string, FSWatcher>();
let generation = 0;
let epoch = 0;
let watchersHealthy = true;

export function clearGlobalProfileStatusCache(): void {
  generation += 1;
  epoch += 1;
  buckets.clear();
  inflight.clear();
  closeWatchers();
  watchersHealthy = true;
}

/** True when every fingerprint path was watched. Tests and the perf budget use this. */
export function statusCacheWatchersHealthy(): boolean {
  return watchersHealthy;
}

/** Force the mtime fingerprint fallback and stop watcher events. Tests use this. */
export function markStatusCacheWatchersUnreliable(): void {
  watchersHealthy = false;
  closeWatchers();
}

/** Bumped when a watcher sees a change. Tests use this. */
export function readStatusCacheEpoch(): number {
  return epoch;
}

function closeWatchers(): void {
  for (const watcher of watchers.values()) {
    watcher.close();
  }
  watchers.clear();
}

function markDirty(): void {
  epoch += 1;
}

function expandHomePath(value: string, home: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/")) return join(home, value.slice(2));
  return value;
}

function pushPath(paths: string[], value: unknown, home: string): void {
  if (typeof value === "string" && value.length > 0) {
    paths.push(expandHomePath(value, home));
    return;
  }
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) {
      paths.push(expandHomePath(item, home));
    }
  }
}

function harnessConfigPaths(home: string): string[] {
  const paths: string[] = [];
  for (const platform of getAllPlatforms()) {
    const { pathAlternates, ...files } = platform.globalPaths;
    for (const value of Object.values(files)) {
      pushPath(paths, value, home);
    }
    if (pathAlternates) {
      for (const value of Object.values(pathAlternates)) {
        pushPath(paths, value, home);
      }
    }
  }
  return paths;
}

function marketplaceInstallRoots(home: string): string[] {
  const knownPath = join(home, ".claude", "plugins", "known_marketplaces.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(knownPath, "utf8"));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const roots: string[] = [];
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const location = (value as { installLocation?: unknown }).installLocation;
    if (typeof location === "string" && location.trim()) {
      roots.push(location.trim());
    }
  }
  return roots;
}

function manifestPathsUnder(root: string): string[] {
  const found: string[] = [];
  for (const relative of MANIFEST_RELATIVE_PATHS) {
    const path = join(root, relative);
    if (existsSync(path)) found.push(path);
  }
  return found;
}

function marketplaceManifestPaths(home: string): string[] {
  const roots = [
    join(home, ".claude", "plugins", "marketplaces"),
    ...marketplaceInstallRoots(home),
  ];
  const found: string[] = [];
  for (const root of roots) {
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      found.push(...manifestPathsUnder(root));
      continue;
    }
    for (const name of names) {
      const child = join(root, name);
      try {
        if (!statSync(child).isDirectory()) continue;
      } catch {
        continue;
      }
      found.push(...manifestPathsUnder(child));
    }
  }
  return found;
}

function recursiveWatchPaths(home: string): Set<string> {
  const plugins = join(home, ".cursor", "plugins");
  const paths = new Set<string>([
    plugins,
    join(plugins, "local"),
    join(plugins, "cache"),
    join(home, ".claude", "plugins", "marketplaces"),
  ]);
  for (const root of marketplaceInstallRoots(home)) {
    paths.add(root);
  }
  return paths;
}

/**
 * Cheap input fingerprint: mtime and size of the profiles database, harness
 * config, Cursor plugin roots, state.vscdb, marketplace manifests, and the
 * files the last status read compared. No log walk and no database read.
 */
function collectFingerprintPaths(
  projectPath: string | undefined,
  extra: readonly string[],
): { paths: string[]; recursive: Set<string> } {
  const home = resolveHomeRoot();
  const plugins = join(home, ".cursor", "plugins");
  const newestLog = findNewestCursorPluginsLog(home);
  const paths = [
    getDbPath(),
    cursorStateDbPath(home),
    join(cursorUserDataDir(home), "logs"),
    plugins,
    join(plugins, "installed.json"),
    join(plugins, "installed_plugins.json"),
    join(plugins, "local"),
    join(home, ".claude", "plugins", "installed_plugins.json"),
    join(home, ".claude", "plugins", "known_marketplaces.json"),
    join(home, ".claude", "plugins", "marketplaces"),
    join(cursorUserDataDir(home), "User", "settings.json"),
    ...(newestLog ? [newestLog.path] : []),
    ...harnessConfigPaths(home),
    ...marketplaceManifestPaths(home),
    ...projectDriftWatchPaths(projectPath),
    ...extra,
  ];
  return { paths: uniquePaths(paths), recursive: recursiveWatchPaths(home) };
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of paths) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    unique.push(path);
  }
  unique.sort();
  return unique;
}

function fingerprintPaths(paths: readonly string[]): string {
  return paths.map((path) => `${path}=${fileSignature(path)}`).join("\n");
}

function startWatcher(path: string, recursive: boolean): FSWatcher {
  let ready = false;
  const watcher = watch(path, { persistent: false, recursive }, () => {
    if (!ready) return;
    markDirty();
  });
  watcher.on("error", () => {
    markDirty();
    watcher.close();
    watchers.delete(watcherKey(path, recursive));
  });
  setTimeout(() => {
    ready = true;
  }, 0);
  return watcher;
}

function watcherKey(path: string, recursive: boolean): string {
  return `${recursive ? "r" : "n"}\0${path}`;
}

function watchOne(path: string, recursive: boolean): void {
  try {
    if (!statSync(path).isDirectory()) recursive = false;
  } catch {
    return;
  }
  const key = watcherKey(path, recursive);
  if (
    watchers.has(key)
    || watchers.has(watcherKey(path, true))
    || watchers.has(watcherKey(path, false))
  ) {
    return;
  }
  try {
    watchers.set(key, startWatcher(path, recursive));
  } catch {
    if (!recursive) {
      watchersHealthy = false;
      return;
    }
    try {
      watchers.set(watcherKey(path, false), startWatcher(path, false));
    } catch {
      watchersHealthy = false;
      return;
    }
    // Nested edits under this directory are not signaled. Fall back to mtimes.
    watchersHealthy = false;
  }
}

function ensureWatchers(paths: readonly string[], recursive: ReadonlySet<string>, home: string): void {
  for (const path of paths) {
    let isDirectory = false;
    try {
      isDirectory = statSync(path).isDirectory();
    } catch {
      const parent = dirname(path);
      if (parent === path || parent === home || parent === dirname(home)) continue;
      watchOne(parent, false);
      continue;
    }
    watchOne(path, isDirectory && recursive.has(path));
  }
}

function entryIsCurrent(entry: CacheEntry<unknown>): boolean {
  if (entry.epoch !== epoch) return false;
  if (!watchersHealthy) {
    return fingerprintPaths(entry.paths) === entry.fingerprint;
  }
  return true;
}

function present<T>(value: T, refreshing: boolean): T & { refreshing: boolean } {
  const copy = structuredClone(value) as T & { refreshing: boolean };
  copy.refreshing = refreshing;
  return copy;
}

function requestKey(input: StatusCacheRequest): string {
  const profile = getActiveProfileName() ?? "";
  const depth = input.includeDepth === false ? "*" : (input.depth ?? "full");
  return [
    resolveHomeRoot(),
    depth,
    input.harness ?? "",
    input.projectPath ?? "",
    profile,
  ].join("\0");
}

function remember<T>(
  key: string,
  projectPath: string | undefined,
  loaded: { value: T; watchedPaths: readonly string[] },
  epochAtStart: number,
): void {
  const home = resolveHomeRoot();
  const collected = collectFingerprintPaths(projectPath, loaded.watchedPaths);
  ensureWatchers(collected.paths, collected.recursive, home);
  const next: CacheEntry<T> = {
    paths: collected.paths,
    fingerprint: fingerprintPaths(collected.paths),
    epoch: epoch,
    value: loaded.value,
  };
  buckets.set(key, next);
  if (epoch !== epochAtStart) {
    // A watched input changed while this value was computed. Keep the value
    // for a stale response, but the next read must recompute.
    next.epoch = epochAtStart;
  }
  if (buckets.size > 16) {
    const oldest = buckets.keys().next().value;
    if (oldest) buckets.delete(oldest);
  }
}

function scheduleRefresh<T>(
  key: string,
  projectPath: string | undefined,
  load: () => Promise<{ value: T; watchedPaths: readonly string[] }>,
): void {
  const gen = generation;
  const pending = inflight.get(key);
  if (pending && pending.generation === gen) return;

  let resolveDone: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  inflight.set(key, { generation: gen, promise });
  const epochAtStart = epoch;
  void (async () => {
    try {
      const loaded = await load();
      if (gen !== generation) return;
      remember(key, projectPath, loaded, epochAtStart);
    } catch {
      // Keep the last result. The next read tries again. A clear during
      // this load bumps generation so a torn-down library is not stored.
    } finally {
      resolveDone();
      const current = inflight.get(key);
      if (current?.promise === promise) inflight.delete(key);
    }
  })();
}

async function loadNow<T>(
  key: string,
  projectPath: string | undefined,
  load: () => Promise<{ value: T; watchedPaths: readonly string[] }>,
): Promise<T & { refreshing: boolean }> {
  const gen = generation;
  const pending = inflight.get(key);
  if (pending && pending.generation === gen) {
    await pending.promise;
    const cached = buckets.get(key) as CacheEntry<T> | undefined;
    if (cached && entryIsCurrent(cached)) {
      return present(cached.value, false);
    }
  }

  let resolveDone: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  inflight.set(key, { generation: gen, promise });
  const epochAtStart = epoch;
  try {
    const loaded = await load();
    if (gen === generation) {
      remember(key, projectPath, loaded, epochAtStart);
    }
    const cached = buckets.get(key) as CacheEntry<T> | undefined;
    if (cached && cached.value === loaded.value && entryIsCurrent(cached)) {
      return present(cached.value, false);
    }
    return present(loaded.value, false);
  } finally {
    resolveDone();
    const current = inflight.get(key);
    if (current?.promise === promise) inflight.delete(key);
  }
}

/**
 * Reuse a full status result while its input fingerprint is unchanged.
 * Healthy file watchers make a warm read a map lookup. Where a watcher
 * cannot be installed, the same fingerprint of mtimes and sizes is checked
 * instead. Concurrent callers for one key share one in-flight load.
 */
export async function withStatusReadCache<T>(
  input: StatusCacheRequest,
  load: () => Promise<{ value: T; watchedPaths: readonly string[] }>,
  options?: StatusCacheLoadOptions,
): Promise<T & { refreshing: boolean }> {
  const key = requestKey(input);
  const cached = buckets.get(key) as CacheEntry<T> | undefined;
  if (cached && entryIsCurrent(cached)) {
    return present(cached.value, false);
  }

  if (options?.staleWhileRefresh && cached) {
    scheduleRefresh(key, input.projectPath, load);
    return present(cached.value, true);
  }

  return loadNow(key, input.projectPath, load);
}
