import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { dirname, join, sep } from "node:path";
import { Worker } from "node:worker_threads";
import { getDbPath } from "../db/connection.js";
import { cursorUserDataDir } from "../plugins/cursor-enablement.js";
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
  /** Mtime fingerprint of watched files. Empty while watchers are healthy. */
  pathSig: string;
  /** Epoch observed when this value was stored. A newer epoch is dirty. */
  epoch: number;
  value: T;
}

const armedPaths = new Set<string>();
const pendingWatchPaths: string[] = [];
const pendingWatchSet = new Set<string>();
let pendingRecursive = new Set<string>();
let pendingHome = "";
let watchArmTimer: ReturnType<typeof setTimeout> | null = null;
/** Home whose out-of-tree watchers were last retained. Unchanged homes keep every watcher. */
let retainedForHome = "";

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
  watchersHealthy = true;
}

/** Bump the cache epoch so the next read recomputes. Tests use this. */
export function markStatusCacheStaleForTests(): void {
  epoch += 1;
}

let statusRefreshDelayMs = 0;

/** Hold the refresh worker this long before it computes. Tests use this. */
export function setStatusRefreshDelayMs(ms: number): void {
  statusRefreshDelayMs = ms;
}

let watcherCreates = 0;

/** How many filesystem watchers were constructed. */
export function readStatusWatcherCreateCount(): number {
  return watcherCreates;
}

let refreshCompletions = 0;

/** How many background refreshes stored a new status. */
export function readStatusRefreshCompletionCount(): number {
  return refreshCompletions;
}

/** True when every fingerprint path was watched. Tests and the perf budget use this. */
export function statusCacheWatchersHealthy(): boolean {
  return watchersHealthy;
}

/** Force the mtime fingerprint fallback and stop watcher events. Tests use this. */
export function markStatusCacheWatchersUnreliable(): void {
  watchersHealthy = false;
  closeWatchers();
  snapshotPathSignatures();
}

/** Bumped when a watcher sees a change. Tests use this. */
export function readStatusCacheEpoch(): number {
  return epoch;
}

function watcherPath(key: string): string {
  return key.slice(2);
}

function closeWatchers(): void {
  for (const [key, watcher] of watchers) {
    watcher.close();
    armedPaths.delete(watcherPath(key));
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
 * Mtime fingerprint of files whose bytes matter. Cursor's state.vscdb and
 * logs folder are not included. Status does not read them.
 */
function collectFingerprintPaths(
  projectPath: string | undefined,
  extra: readonly string[],
): { paths: string[]; recursive: Set<string> } {
  const home = resolveHomeRoot();
  const plugins = join(home, ".cursor", "plugins");
  const paths = [
    getDbPath(),
    plugins,
    join(plugins, "installed.json"),
    join(plugins, "installed_plugins.json"),
    join(plugins, "local"),
    join(home, ".claude", "plugins", "installed_plugins.json"),
    join(home, ".claude", "plugins", "known_marketplaces.json"),
    join(home, ".claude", "plugins", "marketplaces"),
    join(cursorUserDataDir(home), "User", "settings.json"),
    join(home, ".cursor", "projects", "mcps"),
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
  watcherCreates += 1;
  let ready = false;
  const watcher = watch(path, { persistent: false, recursive }, () => {
    if (!ready) return;
    markDirty();
  });
  watcher.on("error", () => {
    markDirty();
    watcher.close();
    watchers.delete(watcherKey(path, recursive));
    armedPaths.delete(path);
  });
  setTimeout(() => {
    ready = true;
  }, 0);
  return watcher;
}

function watcherKey(path: string, recursive: boolean): string {
  return `${recursive ? "r" : "n"}\0${path}`;
}

function snapshotPathSignatures(): void {
  for (const entry of buckets.values()) {
    if (entry.pathSig === "") {
      entry.pathSig = fingerprintPaths(entry.paths);
    }
  }
}

function markWatchersUnhealthy(): void {
  if (!watchersHealthy) return;
  watchersHealthy = false;
  snapshotPathSignatures();
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
      markWatchersUnhealthy();
      return;
    }
    try {
      watchers.set(watcherKey(path, false), startWatcher(path, false));
    } catch {
      markWatchersUnhealthy();
      return;
    }
    // Nested edits under this directory are not signaled. Fall back to mtimes.
    markWatchersUnhealthy();
  }
}

function hasWatcher(path: string): boolean {
  return watchers.has(watcherKey(path, true)) || watchers.has(watcherKey(path, false));
}

function isUnderHome(path: string, home: string): boolean {
  const prefix = home.endsWith(sep) ? home : `${home}${sep}`;
  return path === home || path.startsWith(prefix);
}

function retainWatchersForHome(home: string): void {
  const dbPath = getDbPath();
  for (const [key, watcher] of watchers) {
    const path = watcherPath(key);
    if (path === dbPath || isUnderHome(path, home)) continue;
    watcher.close();
    watchers.delete(key);
    armedPaths.delete(path);
  }
}

function ensureWatchers(paths: readonly string[], recursive: ReadonlySet<string>, home: string): void {
  for (const path of paths) {
    if (hasWatcher(path)) continue;
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

/** Arm each path once per process, off the status await. */
function scheduleWatchers(paths: readonly string[], recursive: ReadonlySet<string>, home: string): void {
  if (home !== retainedForHome) {
    retainWatchersForHome(home);
    retainedForHome = home;
  }
  let added = false;
  for (const path of paths) {
    if (armedPaths.has(path) || pendingWatchSet.has(path)) continue;
    pendingWatchPaths.push(path);
    pendingWatchSet.add(path);
    added = true;
  }
  for (const path of recursive) pendingRecursive.add(path);
  pendingHome = home;
  if (!added || watchArmTimer) return;
  watchArmTimer = setTimeout(() => {
    watchArmTimer = null;
    const batch = pendingWatchPaths.splice(0, pendingWatchPaths.length);
    pendingWatchSet.clear();
    const recursiveNow = pendingRecursive;
    pendingRecursive = new Set();
    const homeNow = pendingHome;
    for (const path of batch) armedPaths.add(path);
    ensureWatchers(batch, recursiveNow, homeNow);
  }, 0);
}

function entryIsCurrent(entry: CacheEntry<unknown>): boolean {
  if (entry.epoch !== epoch) return false;
  if (!watchersHealthy) {
    const sig = fingerprintPaths(entry.paths);
    if (entry.pathSig === "") {
      entry.pathSig = sig;
      return false;
    }
    return sig === entry.pathSig;
  }
  return true;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

/**
 * Shallow copy so `refreshing` can change. Nested fields stay the frozen
 * snapshot stored at compute time.
 */
function present<T extends object>(value: T, refreshing: boolean): T & { refreshing: boolean } {
  return { ...value, refreshing };
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
  scheduleWatchers(collected.paths, collected.recursive, home);
  const next: CacheEntry<T> = {
    paths: collected.paths,
    pathSig: watchersHealthy ? "" : fingerprintPaths(collected.paths),
    epoch: epoch,
    value: deepFreeze(loaded.value),
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

interface RefreshOutcome {
  ok: boolean;
  value?: unknown;
  watchedPaths?: string[];
}

interface RefreshJob {
  key: string;
  projectPath: string | undefined;
  generation: number;
  epochAtStart: number;
  home: string | undefined;
  resolve: (outcome: RefreshOutcome) => void;
}

interface RefreshResultMessage {
  id: number;
  ok: boolean;
  value?: unknown;
  watchedPaths?: string[];
}

let refreshWorker: Worker | null = null;
let refreshSeq = 0;
const refreshJobs = new Map<number, RefreshJob>();
let workerFailed = false;
let keepStatusWorkerAlive = false;
let workerCreates = 0;
let respawnAttempts = 0;
let respawnTimer: ReturnType<typeof setTimeout> | null = null;

/** How many refresh workers this process has constructed. */
export function readStatusRefreshWorkerCreateCount(): number {
  return workerCreates;
}

function releaseRefreshJobs(): void {
  const jobs = [...refreshJobs.values()];
  refreshJobs.clear();
  for (const job of jobs) job.resolve({ ok: false });
}

function scheduleWorkerRespawn(): void {
  if (!keepStatusWorkerAlive || respawnTimer || respawnAttempts >= 3) return;
  respawnAttempts += 1;
  const timer = setTimeout(() => {
    respawnTimer = null;
    if (refreshWorker || !keepStatusWorkerAlive) return;
    workerFailed = false;
    try {
      statusWorker();
    } catch {
      workerFailed = true;
    }
  }, 0);
  respawnTimer = timer;
  timer.unref();
}

/**
 * Bun test loads the worker from this module's URL. A compiled sidecar
 * bundles that file as a second entry, and import.meta.url is the binary, so
 * the embedded path is the one `bun build --compile` registers.
 */
function statusRefreshWorkerTarget(): string | URL {
  const url = import.meta.url;
  if (url.includes("/$bunfs/") || url.includes("~BUN")) {
    return "/$bunfs/root/services/status-refresh-worker.ts";
  }
  return new URL("./status-refresh-worker.ts", import.meta.url);
}

function statusWorker(): Worker {
  if (refreshWorker) return refreshWorker;
  workerCreates += 1;
  const worker = new Worker(statusRefreshWorkerTarget());
  worker.unref();
  worker.on("message", (message: RefreshResultMessage) => {
    const job = refreshJobs.get(message.id);
    if (!job) return;
    refreshJobs.delete(message.id);
    try {
      if (!message.ok || message.value === undefined || !message.watchedPaths) {
        job.resolve({ ok: false });
        return;
      }
      const frozen = deepFreeze(message.value);
      if (job.home === process.env.HOME && job.generation === generation) {
        remember(job.key, job.projectPath, {
          value: frozen,
          watchedPaths: message.watchedPaths,
        }, job.epochAtStart);
        refreshCompletions += 1;
        respawnAttempts = 0;
      }
      job.resolve({
        ok: true,
        value: frozen,
        watchedPaths: message.watchedPaths,
      });
    } catch {
      job.resolve({ ok: false });
    }
  });
  worker.on("error", () => {
    if (refreshWorker === worker) refreshWorker = null;
    workerFailed = true;
    releaseRefreshJobs();
    scheduleWorkerRespawn();
  });
  worker.on("exit", () => {
    if (refreshWorker !== worker) return;
    refreshWorker = null;
    releaseRefreshJobs();
    scheduleWorkerRespawn();
  });
  refreshWorker = worker;
  return worker;
}

/**
 * Construct the refresh worker during sidecar boot. The first `Worker`
 * start is synchronous and is the stall on a cold status read. Later reads
 * reuse this thread. If it exits, it is started again.
 */
export function warmStatusRefreshWorker(): void {
  keepStatusWorkerAlive = true;
  workerFailed = false;
  try {
    statusWorker();
  } catch {
    workerFailed = true;
    scheduleWorkerRespawn();
  }
}

function blockRefreshDelay(): void {
  if (statusRefreshDelayMs <= 0) return;
  const shared = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(shared), 0, 0, statusRefreshDelayMs);
}

function enqueueStatusRefresh<T extends object>(
  key: string,
  projectPath: string | undefined,
  input: StatusCacheRequest,
  load: () => Promise<{ value: T; watchedPaths: readonly string[] }>,
  epochAtStart: number,
  gen: number,
): Promise<RefreshOutcome> {
  const home = process.env.HOME;
  return new Promise((resolve) => {
    const runInProcess = () => {
      setTimeout(() => {
        void (async () => {
          try {
            blockRefreshDelay();
            const loaded = await load();
            if (gen === generation && home === process.env.HOME) {
              remember(key, projectPath, loaded, epochAtStart);
              refreshCompletions += 1;
            }
            resolve({
              ok: true,
              value: deepFreeze(loaded.value),
              watchedPaths: [...loaded.watchedPaths],
            });
          } catch {
            resolve({ ok: false });
          }
        })();
      }, 0);
    };

    if (workerFailed && !refreshWorker && !keepStatusWorkerAlive) {
      runInProcess();
      return;
    }

    let worker: Worker;
    try {
      worker = statusWorker();
    } catch {
      workerFailed = true;
      runInProcess();
      return;
    }

    const id = ++refreshSeq;
    refreshJobs.set(id, {
      key,
      projectPath,
      generation: gen,
      epochAtStart,
      home,
      resolve,
    });
    try {
      worker.postMessage({
        id,
        home,
        userProfile: process.env.USERPROFILE,
        harnesstapHome: process.env.HARNESSTAP_HOME,
        depth: input.depth,
        harness: input.harness,
        projectPath: input.projectPath,
        delayMs: statusRefreshDelayMs,
      });
    } catch {
      refreshJobs.delete(id);
      workerFailed = true;
      refreshWorker = null;
      runInProcess();
    }
  });
}

function trackRefresh<T extends object>(
  key: string,
  projectPath: string | undefined,
  input: StatusCacheRequest,
  load: () => Promise<{ value: T; watchedPaths: readonly string[] }>,
  gen: number,
): Promise<RefreshOutcome> {
  let resolveDone: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  inflight.set(key, { generation: gen, promise });
  const epochAtStart = epoch;
  return enqueueStatusRefresh(key, projectPath, input, load, epochAtStart, gen).finally(() => {
    resolveDone();
    const current = inflight.get(key);
    if (current?.promise === promise) inflight.delete(key);
  });
}

function scheduleRefresh<T extends object>(
  key: string,
  projectPath: string | undefined,
  input: StatusCacheRequest,
  load: () => Promise<{ value: T; watchedPaths: readonly string[] }>,
): void {
  const gen = generation;
  const pending = inflight.get(key);
  if (pending && pending.generation === gen) return;
  void trackRefresh(key, projectPath, input, load, gen);
}

async function loadNow<T extends object>(
  key: string,
  projectPath: string | undefined,
  input: StatusCacheRequest,
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

  const outcome = await trackRefresh(key, projectPath, input, load, gen);
  const cached = buckets.get(key) as CacheEntry<T> | undefined;
  if (cached && gen === generation && entryIsCurrent(cached)) {
    return present(cached.value, false);
  }
  if (outcome.ok && outcome.value !== undefined) {
    return present(outcome.value as T, false);
  }
  throw new Error("Status read failed");
}

/**
 * Reuse a full status result while watched inputs are unchanged. Healthy file
 * watchers make that check a map lookup. Where a watcher could not be
 * installed, mtimes and sizes of those files are checked instead. Status does
 * not read Cursor's state.vscdb or logs folder. A cold read waits on the
 * refresh worker and does not run the dry-run on this thread. Concurrent
 * callers for one key share one in-flight load.
 */
export async function withStatusReadCache<T extends object>(
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
    scheduleRefresh(key, input.projectPath, input, load);
    return present(cached.value, true);
  }

  return loadNow(key, input.projectPath, input, load);
}
