import { createRequire } from "node:module";
import { sep } from "node:path";
import { mock } from "bun:test";

const nodeRequire = createRequire(import.meta.url);
const actualFs = nodeRequire("node:fs") as typeof import("node:fs");
const actualSqlite = nodeRequire("bun:sqlite") as typeof import("bun:sqlite");

let cursorLogsReads = 0;
let cursorStateDbOpens = 0;

function noteLogsPath(path: unknown): void {
  if (typeof path !== "string") return;
  if (path.endsWith(`${sep}logs`) || path.includes(`${sep}logs${sep}`)) {
    cursorLogsReads += 1;
  }
}

/** When set, the next few main-thread watches spin so a stalled event loop is obvious. */
let delayMainThreadWatches = 0;

mock.module("node:fs", () => ({
  ...actualFs,
  readdirSync(path: string, options?: object) {
    noteLogsPath(path);
    return actualFs.readdirSync(path, options as never);
  },
  readFileSync(path: string, options?: object) {
    noteLogsPath(path);
    return actualFs.readFileSync(path, options as never);
  },
  statSync(path: string, options?: object) {
    noteLogsPath(path);
    return actualFs.statSync(path, options as never);
  },
  openSync(path: string, flags?: string, mode?: number) {
    noteLogsPath(path);
    return actualFs.openSync(path, flags, mode);
  },
  watch(path: string, options?: object, listener?: unknown) {
    if (delayMainThreadWatches > 0) {
      delayMainThreadWatches -= 1;
      const until = performance.now() + 40;
      while (performance.now() < until) {
        // Simulate a slow fs.watch of a large Cursor tree on the calling thread.
      }
    }
    if (typeof options === "function") {
      return actualFs.watch(path, options as never);
    }
    return actualFs.watch(path, options as never, listener as never);
  },
}));

mock.module("bun:sqlite", () => {
  const Original = actualSqlite.Database;
  class CountingDatabase extends Original {
    constructor(filename?: string, options?: { readonly?: boolean }) {
      if (typeof filename === "string" && filename.endsWith(`${sep}state.vscdb`)) {
        cursorStateDbOpens += 1;
      }
      super(filename, options);
    }
  }
  return { ...actualSqlite, Database: CountingDatabase };
});

import { mkdirSync, readdirSync, writeFileSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import {
  addDependencyToPlugin,
  addResourceToPlugin,
  createPlugin,
  readPluginByNameLookupCount,
  readPluginByNamePrepareCount,
  setPluginTags,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { cursorUserDataDir } from "../../src/plugins/cursor-enablement.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import {
  detectGlobalProfileStatus,
  readDriftCoreComputeCount,
} from "../../src/services/global-profile-drift.ts";
import { clearLiveReadCaches } from "../../src/services/live-read-cache.ts";
import {
  markStatusCacheStaleForTests,
  readStatusRefreshCompletionCount,
  readStatusRefreshWorkerCreateCount,
  readStatusWatcherCreateCount,
  setStatusRefreshDelayMs,
  statusCacheWatchersHealthy,
  warmStatusRefreshWorker,
} from "../../src/services/status-read-cache.ts";
import { getDb } from "../../src/db/connection.ts";
import { readStatusWriteGeneration, statementAffectsStatus } from "../../src/db/write-generation.ts";
import { readUpstreamCheckSummary } from "../../src/services/upstream-check-read.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

const RESOURCE_COUNT = 70;
/** Product warm target is at most 50ms. A healthy watcher hit is a map lookup. */
const WARM_BUDGET_MS = 50;
/**
 * Product cold target is 200ms on a desktop. CI gets headroom. The
 * machine-independent guard is that status never opens state.vscdb or reads
 * the Cursor logs folder.
 */
const COLD_BUDGET_MS = 500;
/** A blocked event loop shows up as a timer gap. Cold and refresh must stay under this. */
const STALL_BUDGET_MS = 50;

function watchEventLoopGap(): { stop: () => number } {
  let maxGap = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const gap = now - last;
    if (gap > maxGap) maxGap = gap;
    last = now;
  }, 10);
  return {
    stop() {
      clearInterval(timer);
      return maxGap;
    },
  };
}

function stable(status: Awaited<ReturnType<typeof detectGlobalProfileStatus>>): string {
  const copy = structuredClone(status);
  copy.as_of = "";
  return JSON.stringify(copy);
}

function countFiles(dir: string): number {
  let count = 0;
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) count += countFiles(absolute);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

function writeCursorHome(home: string): { logs: string; dbPath: string } {
  const logs = join(cursorUserDataDir(home), "logs");
  const session = join(logs, "20261014T235959", "window1");
  mkdirSync(session, { recursive: true });
  writeFileSync(join(session, "Cursor Plugins.log"), "loadUserLocalPlugin demo loaded\n");
  const dbPath = join(cursorUserDataDir(home), "User", "globalStorage", "state.vscdb");
  mkdirSync(join(dbPath, ".."), { recursive: true });
  const db = new Database(dbPath);
  db.run("CREATE TABLE ItemTable (key TEXT UNIQUE, value BLOB)");
  db.run(
    "INSERT INTO ItemTable (key, value) VALUES (?, ?)",
    ["cursor.plugins.installedIds.no-team", JSON.stringify(["slack"])],
  );
  db.close();
  return { logs, dbPath };
}

describe("status perf", () => {
  it("keeps a warm status under budget on a large Cursor home", async () => {
    const context = await createInitializedTestContext("status-perf");
    try {
      clearLiveReadCaches();
      const cursorHome = writeCursorHome(context.homeDir);
      expect(readdirSync(cursorHome.logs).length).toBe(1);
      expect(countFiles(cursorHome.logs)).toBeGreaterThan(0);
      const plugin = createPlugin({ name: "perf-profile" });
      setPluginTags(plugin.id, ["profile"]);
      for (let index = 0; index < 24; index += 1) {
        const dependency = createPlugin({ name: `perf-dep-${index}` });
        addDependencyToPlugin(plugin.id, dependency.name, "*");
      }
      for (let index = 0; index < RESOURCE_COUNT; index += 1) {
        addResourceToPlugin(
          plugin.id,
          createResource({
            type: "skill",
            name: `skill-${index}`,
            description: "",
            content: `# skill ${index}\n`,
            metadata: {},
            source: "manual",
            origin_kind: "marketplace_link",
            origin_ref: `skill-${index}@cursor-public`,
          }).id,
        );
      }
      setActiveProfileName("perf-profile");

      setStatusRefreshDelayMs(0);
      warmStatusRefreshWorker();
      const workers = readStatusRefreshWorkerCreateCount();
      expect(cursorStateDbOpens).toBeGreaterThan(0);
      expect(cursorLogsReads).toBeGreaterThan(0);
      cursorLogsReads = 0;
      cursorStateDbOpens = 0;
      const before = readDriftCoreComputeCount();
      const preparesBefore = readPluginByNamePrepareCount();
      const lookupsBefore = readPluginByNameLookupCount();
      const watchersBefore = readStatusWatcherCreateCount();
      const gap = watchEventLoopGap();
      const coldStarted = performance.now();
      const cold = await detectGlobalProfileStatus({ depth: "full" });
      const coldMs = performance.now() - coldStarted;
      const prepareDelta = readPluginByNamePrepareCount() - preparesBefore;
      const lookupDelta = readPluginByNameLookupCount() - lookupsBefore;
      const warmStarted = performance.now();
      const warm = await detectGlobalProfileStatus({ depth: "full" });
      const warmMs = performance.now() - warmStarted;
      const armDeadline = Date.now() + 2000;
      let watchersArmed = readStatusWatcherCreateCount();
      // Earlier tests in the same process may have armed watchers already.
      while (watchersArmed === watchersBefore && Date.now() < armDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 15));
        watchersArmed = readStatusWatcherCreateCount();
      }

      clearLiveReadCaches();
      const recomputeStarted = performance.now();
      const recomputed = await detectGlobalProfileStatus({ depth: "full" });
      const recomputeMs = performance.now() - recomputeStarted;
      const coldStallMs = gap.stop();
      console.log(
        `status perf cold=${coldMs.toFixed(1)}ms warm=${warmMs.toFixed(1)}ms recompute=${recomputeMs.toFixed(1)}ms prepares=${prepareDelta} lookups=${lookupDelta} watchers=${watchersArmed} vscdbOpens=${cursorStateDbOpens} logsReads=${cursorLogsReads} coldStall=${coldStallMs.toFixed(1)}ms`,
      );

      expect(lookupDelta).toBe(0);
      expect(prepareDelta).toBe(0);
      expect(coldMs).toBeLessThan(COLD_BUDGET_MS);
      expect(recomputeMs).toBeLessThan(COLD_BUDGET_MS);
      expect(warmMs).toBeLessThan(WARM_BUDGET_MS);
      expect(cold.refreshing).toBe(false);
      expect(warm.refreshing).toBe(false);
      expect(recomputed.refreshing).toBe(false);
      expect(watchersArmed).toBeGreaterThan(watchersBefore);
      expect(statusCacheWatchersHealthy()).toBe(true);
      expect(stable(warm)).toBe(stable(cold));
      expect(stable(recomputed)).toBe(stable(cold));
      expect(readDriftCoreComputeCount() - before).toBe(0);
      const refreshGap = watchEventLoopGap();
      markStatusCacheStaleForTests();
      const during = await detectGlobalProfileStatus({ depth: "full" });
      expect(during.refreshing).toBe(true);
      const refreshDeadline = Date.now() + 8000;
      let settled = during;
      while (Date.now() < refreshDeadline) {
        settled = await detectGlobalProfileStatus({ depth: "full" });
        if (!settled.refreshing) break;
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      const refreshStallMs = refreshGap.stop();
      const stallMs = Math.max(coldStallMs, refreshStallMs);
      console.log(`status stall maxGap=${stallMs.toFixed(1)}ms workers=${readStatusRefreshWorkerCreateCount()}`);

      expect(settled.refreshing).toBe(false);
      expect(stallMs).toBeLessThan(STALL_BUDGET_MS);
      expect(readStatusRefreshWorkerCreateCount()).toBe(workers);
      expect(cold.contents?.resources.length).toBe(RESOURCE_COUNT);
      expect(cursorStateDbOpens).toBe(0);
      expect(cursorLogsReads).toBe(0);
      expect(readStatusWatcherCreateCount()).toBe(watchersArmed);
    } finally {
      clearLiveReadCaches();
      await context.cleanup();
    }
  });

  it("keeps each of the ten warm reads after cold start under budget", async () => {
    const context = await createInitializedTestContext("status-perf-warm-burst");
    try {
      clearLiveReadCaches();
      writeCursorHome(context.homeDir);
      const plugin = createPlugin({ name: "warm-burst" });
      setPluginTags(plugin.id, ["profile"]);
      addResourceToPlugin(
        plugin.id,
        createResource({
          type: "skill",
          name: "skill-warm",
          description: "",
          content: "# warm\n",
          metadata: {},
          source: "manual",
          origin_kind: "marketplace_link",
          origin_ref: "skill-warm@cursor-public",
        }).id,
      );
      setActiveProfileName("warm-burst");
      setStatusRefreshDelayMs(0);
      warmStatusRefreshWorker();
      delayMainThreadWatches = 8;
      const cold = await detectGlobalProfileStatus({ depth: "full" });
      expect(cold.refreshing).toBe(false);
      const gap = watchEventLoopGap();
      const samples: number[] = [];
      for (let index = 0; index < 10; index += 1) {
        const started = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const warm = await detectGlobalProfileStatus({ depth: "full" });
        const elapsed = performance.now() - started;
        samples.push(elapsed);
        expect(warm.refreshing).toBe(false);
        expect(stable(warm)).toBe(stable(cold));
      }
      const stallMs = gap.stop();
      const slowest = Math.max(...samples);
      console.log(
        `status warm burst ${samples.map((ms) => ms.toFixed(1)).join(",")} slowest=${slowest.toFixed(1)}ms stall=${stallMs.toFixed(1)}ms`,
      );
      expect(slowest).toBeLessThan(WARM_BUDGET_MS);
      expect(stallMs).toBeLessThan(STALL_BUDGET_MS);
    } finally {
      delayMainThreadWatches = 0;
      clearLiveReadCaches();
      await context.cleanup();
    }
  });

  it("returns a warm status while a slow recompute is running", async () => {
    const context = await createInitializedTestContext("status-perf-overlap");
    try {
      clearLiveReadCaches();
      setStatusRefreshDelayMs(0);
      warmStatusRefreshWorker();
      const plugin = createPlugin({ name: "overlap-profile" });
      setPluginTags(plugin.id, ["profile"]);
      addResourceToPlugin(
        plugin.id,
        createResource({
          type: "skill",
          name: "skill-overlap",
          description: "",
          content: "# overlap\n",
          metadata: {},
          source: "manual",
          origin_kind: "marketplace_link",
          origin_ref: "skill-overlap@cursor-public",
        }).id,
      );
      setActiveProfileName("overlap-profile");

      const cold = await detectGlobalProfileStatus({ depth: "full" });
      expect(cold.refreshing).toBe(false);
      const refreshes = readStatusRefreshCompletionCount();
      markStatusCacheStaleForTests();
      const prewarm = await detectGlobalProfileStatus({ depth: "full" });
      expect(prewarm.refreshing).toBe(true);
      const prewarmDeadline = Date.now() + 8000;
      let primed = prewarm;
      while (Date.now() < prewarmDeadline) {
        primed = await detectGlobalProfileStatus({ depth: "full" });
        if (!primed.refreshing && readStatusRefreshCompletionCount() > refreshes) break;
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      expect(primed.refreshing).toBe(false);

      setStatusRefreshDelayMs(400);
      markStatusCacheStaleForTests();
      const computed = readDriftCoreComputeCount();
      const overlapGap = watchEventLoopGap();
      const kickStarted = performance.now();
      const kick = await detectGlobalProfileStatus({ depth: "full" });
      const kickMs = performance.now() - kickStarted;
      expect(kickMs).toBeLessThan(WARM_BUDGET_MS);
      expect(kick.refreshing).toBe(true);

      let slowestMs = kickMs;
      const windowStarted = performance.now();
      while (performance.now() - windowStarted < 200) {
        const started = performance.now();
        const mid = await detectGlobalProfileStatus({ depth: "full" });
        const elapsed = performance.now() - started;
        if (elapsed > slowestMs) slowestMs = elapsed;
        expect(elapsed).toBeLessThan(WARM_BUDGET_MS);
        expect(mid.refreshing).toBe(true);
        expect(stable(mid)).toBe(stable(kick));
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(readDriftCoreComputeCount()).toBe(computed);
      const overlapStallMs = overlapGap.stop();
      expect(overlapStallMs).toBeLessThan(STALL_BUDGET_MS);
      console.log(
        `status overlap kick=${kickMs.toFixed(1)}ms slowest=${slowestMs.toFixed(1)}ms stall=${overlapStallMs.toFixed(1)}ms`,
      );

      const doneDeadline = Date.now() + 8000;
      let done = kick;
      while (Date.now() < doneDeadline) {
        done = await detectGlobalProfileStatus({ depth: "full" });
        if (!done.refreshing) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(done.refreshing).toBe(false);
      expect(readDriftCoreComputeCount()).toBe(computed);
      expect(stable(done)).toBe(stable(cold));
    } finally {
      setStatusRefreshDelayMs(0);
      clearLiveReadCaches();
      await context.cleanup();
    }
  });

  // The budgets are the timed reads inside; the setup (200 inserts, a fresh
  // home, the refresh worker) gets a CI-sized test timeout.
  it("keeps the cold and warm budgets with 200 upstream check rows, read without a recompute", async () => {
    const context = await createInitializedTestContext("status-perf-updates");
    try {
      clearLiveReadCaches();
      writeCursorHome(context.homeDir);
      const plugin = createPlugin({ name: "updates-profile" });
      setPluginTags(plugin.id, ["profile"]);
      setActiveProfileName("updates-profile");
      const insert = getDb().prepare(
        `INSERT INTO upstream_checks
           (plugin_name, ref, local_version, latest_in_range, latest_major, status, checked_at, dismissed_version)
         VALUES (?, ?, '1.0.0', ?, ?, ?, ?, ?)`,
      );
      const now = new Date().toISOString();
      for (let index = 0; index < 200; index += 1) {
        // 120 updates (20 of them dismissed at that version), 40 majors, 40 current.
        const status = index < 120 ? "update" : index < 160 ? "major" : "current";
        insert.run(
          `plugin-${String(index).padStart(3, "0")}`,
          `acme/default/plugin-${index}@^1.0.0`,
          status === "current" ? "1.0.0" : "1.1.0",
          status === "major" ? "2.0.0" : "",
          status,
          now,
          index < 20 ? "1.1.0" : "",
        );
      }

      setStatusRefreshDelayMs(0);
      warmStatusRefreshWorker();
      const summaryStarted = performance.now();
      const summary = readUpstreamCheckSummary();
      const summaryMs = performance.now() - summaryStarted;
      expect(summary).toMatchObject({ count: 100, major_count: 40 });
      expect(summary.items).toHaveLength(5);

      const coldStarted = performance.now();
      const cold = await detectGlobalProfileStatus({ depth: "full" });
      const coldMs = performance.now() - coldStarted;
      const warmStarted = performance.now();
      const warm = await detectGlobalProfileStatus({ depth: "full" });
      const warmMs = performance.now() - warmStarted;
      expect(cold.updates).toMatchObject({ count: 100, major_count: 40 });
      expect(warm.updates).toEqual(cold.updates);

      // A finished background check is a table write. It must not mark the
      // status cache stale, and the next warm read shows the new counts.
      const generation = readStatusWriteGeneration();
      getDb().prepare("UPDATE upstream_checks SET dismissed_version = latest_in_range WHERE status = 'update'").run();
      expect(readStatusWriteGeneration()).toBe(generation);
      const afterStarted = performance.now();
      const after = await detectGlobalProfileStatus({ depth: "full" });
      const afterMs = performance.now() - afterStarted;
      expect(after.refreshing).toBe(false);
      expect(after.updates).toMatchObject({ count: 0, major_count: 40 });
      console.log(
        `status perf updates summary=${summaryMs.toFixed(2)}ms cold=${coldMs.toFixed(1)}ms warm=${warmMs.toFixed(1)}ms afterWrite=${afterMs.toFixed(1)}ms`,
      );
      expect(summaryMs).toBeLessThan(5);
      expect(coldMs).toBeLessThan(COLD_BUDGET_MS);
      expect(warmMs).toBeLessThan(WARM_BUDGET_MS);
      expect(afterMs).toBeLessThan(WARM_BUDGET_MS);
      expect(statementAffectsStatus("INSERT INTO upstream_checks (plugin_name) VALUES ('x')")).toBe(false);
      expect(statementAffectsStatus("DELETE FROM upstream_checks WHERE plugin_name = 'x'")).toBe(false);
      expect(statementAffectsStatus("UPDATE plugins SET name = 'x'")).toBe(true);
    } finally {
      clearLiveReadCaches();
      await context.cleanup();
    }
  }, 20_000);
});
