import { mkdirSync, readdirSync, utimesSync, writeFileSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { addResourceToPlugin, createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { cursorStateDbPath, cursorUserDataDir, expireCursorStateKeysThrottle } from "../../src/plugins/cursor-enablement.ts";
import { readCursorPluginsLogWalkCount } from "../../src/plugins/cursor-local-plugin.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import {
  detectGlobalProfileStatus,
  readDriftCoreComputeCount,
} from "../../src/services/global-profile-drift.ts";
import { clearLiveReadCaches } from "../../src/services/live-read-cache.ts";
import { statusCacheWatchersHealthy } from "../../src/services/status-read-cache.ts";
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

      const before = readDriftCoreComputeCount();
      const walksBefore = readCursorPluginsLogWalkCount();
      const coldStarted = performance.now();
      const cold = await detectGlobalProfileStatus({ depth: "full" });
      const coldMs = performance.now() - coldStarted;
      const warmStarted = performance.now();
      const warm = await detectGlobalProfileStatus({ depth: "full" });
      const warmMs = performance.now() - warmStarted;
      await new Promise((resolve) => setTimeout(resolve, 50));
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
        `status perf cold=${coldMs.toFixed(1)}ms warm=${warmMs.toFixed(1)}ms churn=${churnMs.toFixed(1)}ms recompute=${recomputeMs.toFixed(1)}ms walks=${readCursorPluginsLogWalkCount() - walksBefore}`,
      );

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
      const during = await detectGlobalProfileStatus({ depth: "full" });
      expect(during.refreshing).toBe(true);
      const deadline = Date.now() + 3000;
      let fresh = during;
      while (Date.now() < deadline) {
        fresh = await detectGlobalProfileStatus({ depth: "full" });
        if (!fresh.refreshing && readDriftCoreComputeCount() > computed) break;
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      expect(fresh.refreshing).toBe(false);
      expect(readDriftCoreComputeCount()).toBeGreaterThan(computed);
    } finally {
      clearLiveReadCaches();
      await context.cleanup();
    }
  });
});
