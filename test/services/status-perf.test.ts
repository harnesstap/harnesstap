import { mkdirSync, readdirSync, utimesSync, writeFileSync, type Dirent } from "node:fs";
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
import { cursorStateDbPath, cursorUserDataDir, expireCursorStateKeysThrottle } from "../../src/plugins/cursor-enablement.ts";
import { readCursorPluginsLogWalkCount } from "../../src/plugins/cursor-local-plugin.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import {
  detectGlobalProfileStatus,
  readDriftCoreComputeCount,
} from "../../src/services/global-profile-drift.ts";
import { clearLiveReadCaches } from "../../src/services/live-read-cache.ts";
import {
  markStatusCacheStaleForTests,
  readStatusRefreshCompletionCount,
  readStatusWatcherCreateCount,
  setStatusRefreshDelayMs,
  statusCacheWatchersHealthy,
} from "../../src/services/status-read-cache.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

const OLD_SESSIONS = 370;
const NEWEST_SESSION = "20261014T235959";
const NOISE_FILES = 782;
const NOISE_ROWS = 400;
const NOISE_BYTES = 64 * 1024;
const RESOURCE_COUNT = 70;
/** Product warm target is at most 50ms. A healthy watcher hit is a map lookup. */
const WARM_BUDGET_MS = 50;
/**
 * Product cold target is 200ms on a desktop. CI gets headroom, but a budget
 * this loose would have hidden the 2s Mac cold path. Walk count is the
 * machine-independent guard; this still fails a multi-second recompute.
 */
const COLD_BUDGET_MS = 500;

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

function writeLargeCursorHome(home: string): string {
  const logs = join(cursorUserDataDir(home), "logs");
  const oldStamp = new Date("2020-01-01T00:00:00.000Z");
  for (let index = 0; index < OLD_SESSIONS; index += 1) {
    const session = `20260101T${String(index).padStart(6, "0")}`;
    const dir = join(logs, session, "window1", "exthost", "output");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "exthost.log"), "noise\n");
    utimesSync(join(logs, session), oldStamp, oldStamp);
  }
  const output = join(
    logs,
    NEWEST_SESSION,
    "window1",
    "exthost",
    "anysphere.cursor-retrieval",
    "output",
  );
  const perBucket = 23;
  const buckets = NOISE_FILES / perBucket;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const dir = join(output, `bucket${bucket}`);
    mkdirSync(dir, { recursive: true });
    for (let file = 0; file < perBucket; file += 1) {
      writeFileSync(join(dir, `log${file}.txt`), "noise\n");
    }
  }
  writeFileSync(join(output, "Cursor Plugins.log"), "loadUserLocalPlugin demo loaded\n");
  const newestStamp = new Date("2026-10-14T23:59:59.000Z");
  utimesSync(join(logs, NEWEST_SESSION), newestStamp, newestStamp);

  const dbPath = cursorStateDbPath(home);
  mkdirSync(join(dbPath, ".."), { recursive: true });
  const db = new Database(dbPath);
  db.run("CREATE TABLE ItemTable (key TEXT UNIQUE, value BLOB)");
  const insert = db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)");
  const blob = "x".repeat(NOISE_BYTES);
  const tx = db.transaction(() => {
    for (let index = 0; index < NOISE_ROWS; index += 1) {
      insert.run(`noise.${index}`, blob);
    }
    insert.run(
      "cursor.plugins.installedIds.no-team",
      JSON.stringify(["slack"]),
    );
  });
  tx();
  db.close();
  return logs;
}

function churnUnrelatedCursorWrites(home: string, logs: string): void {
  const db = new Database(cursorStateDbPath(home));
  db.run("UPDATE ItemTable SET value = ? WHERE key = ?", `churn-${Date.now()}`, "noise.0");
  db.close();
  const oldLog = join(logs, "20260101T000000", "window1", "exthost", "output", "exthost.log");
  writeFileSync(oldLog, `noise ${Date.now()}\n`);
  utimesSync(logs, new Date(), new Date());
}

describe("status perf", () => {
  it("keeps a warm status under budget on a large Cursor home", async () => {
    const context = await createInitializedTestContext("status-perf");
    try {
      clearLiveReadCaches();
      const logs = writeLargeCursorHome(context.homeDir);
      expect(readdirSync(logs).length).toBe(OLD_SESSIONS + 1);
      expect(countFiles(logs)).toBe(OLD_SESSIONS + NOISE_FILES + 1);
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
      const before = readDriftCoreComputeCount();
      const walksBefore = readCursorPluginsLogWalkCount();
      const preparesBefore = readPluginByNamePrepareCount();
      const lookupsBefore = readPluginByNameLookupCount();
      const coldStarted = performance.now();
      const cold = await detectGlobalProfileStatus({ depth: "full" });
      const coldMs = performance.now() - coldStarted;
      const prepareDelta = readPluginByNamePrepareCount() - preparesBefore;
      const lookupDelta = readPluginByNameLookupCount() - lookupsBefore;
      const warmStarted = performance.now();
      const warm = await detectGlobalProfileStatus({ depth: "full" });
      const warmMs = performance.now() - warmStarted;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const watchersArmed = readStatusWatcherCreateCount();
      expect(readCursorPluginsLogWalkCount() - walksBefore).toBe(1);

      churnUnrelatedCursorWrites(context.homeDir, logs);
      const churnStarted = performance.now();
      const afterChurn = await detectGlobalProfileStatus({ depth: "full" });
      const churnMs = performance.now() - churnStarted;

      const walksBeforeRecompute = readCursorPluginsLogWalkCount();
      clearLiveReadCaches();
      const recomputeStarted = performance.now();
      const recomputed = await detectGlobalProfileStatus({ depth: "full" });
      const recomputeMs = performance.now() - recomputeStarted;
      console.log(
        `status perf cold=${coldMs.toFixed(1)}ms warm=${warmMs.toFixed(1)}ms churn=${churnMs.toFixed(1)}ms recompute=${recomputeMs.toFixed(1)}ms walks=${readCursorPluginsLogWalkCount() - walksBefore} prepares=${prepareDelta} lookups=${lookupDelta} watchers=${watchersArmed}`,
      );

      expect(lookupDelta).toBeGreaterThan(1);
      expect(prepareDelta).toBeLessThanOrEqual(1);
      expect(coldMs).toBeLessThan(COLD_BUDGET_MS);
      expect(recomputeMs).toBeLessThan(COLD_BUDGET_MS);
      expect(warmMs).toBeLessThan(WARM_BUDGET_MS);
      expect(churnMs).toBeLessThan(WARM_BUDGET_MS);
      expect(cold.refreshing).toBe(false);
      expect(warm.refreshing).toBe(false);
      expect(afterChurn.refreshing).toBe(false);
      expect(recomputed.refreshing).toBe(false);
      expect(statusCacheWatchersHealthy()).toBe(true);
      expect(stable(warm)).toBe(stable(cold));
      expect(stable(afterChurn)).toBe(stable(cold));
      expect(stable(recomputed)).toBe(stable(cold));
      expect(readDriftCoreComputeCount() - before).toBe(2);
      expect(readCursorPluginsLogWalkCount() - walksBefore).toBeLessThanOrEqual(2);
      expect(readCursorPluginsLogWalkCount() - walksBeforeRecompute).toBeLessThanOrEqual(1);
      expect(cold.contents?.resources.length).toBe(RESOURCE_COUNT);

      expireCursorStateKeysThrottle();
      const db = new Database(cursorStateDbPath(context.homeDir));
      db.run(
        "UPDATE ItemTable SET value = ? WHERE key = ?",
        JSON.stringify(["slack", "docs"]),
        "cursor.plugins.installedIds.no-team",
      );
      db.close();
      const computed = readDriftCoreComputeCount();
      const refreshes = readStatusRefreshCompletionCount();
      const during = await detectGlobalProfileStatus({ depth: "full" });
      expect(during.refreshing).toBe(true);
      const deadline = Date.now() + 8000;
      let fresh = during;
      while (Date.now() < deadline) {
        fresh = await detectGlobalProfileStatus({ depth: "full" });
        if (!fresh.refreshing && readStatusRefreshCompletionCount() > refreshes) break;
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      expect(fresh.refreshing).toBe(false);
      expect(readStatusRefreshCompletionCount()).toBe(refreshes + 1);
      expect(readDriftCoreComputeCount()).toBe(computed);
      expect(readStatusWatcherCreateCount()).toBe(watchersArmed);
    } finally {
      clearLiveReadCaches();
      await context.cleanup();
    }
  });

  it("returns a warm status while a slow recompute is running", async () => {
    const context = await createInitializedTestContext("status-perf-overlap");
    try {
      clearLiveReadCaches();
      setStatusRefreshDelayMs(0);
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
      console.log(`status overlap kick=${kickMs.toFixed(1)}ms slowest=${slowestMs.toFixed(1)}ms`);

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
});
