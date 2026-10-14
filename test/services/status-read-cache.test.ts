import { Database } from "bun:sqlite";
import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { getDbPath } from "../../src/db/connection.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createPlugin, addResourceToPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import {
  detectGlobalProfileStatus,
  readDriftCoreComputeCount,
} from "../../src/services/global-profile-drift.ts";
import { clearLiveReadCaches } from "../../src/services/live-read-cache.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import {
  markStatusCacheWatchersUnreliable,
  readStatusCacheEpoch,
  readStatusRefreshCompletionCount,
  readStatusCacheHitCount,
  readStatusCacheLastMissReason,
  readStatusCacheMissCount,
  readStatusWatcherCreateCount,
} from "../../src/services/status-read-cache.ts";

function stable(status: Awaited<ReturnType<typeof detectGlobalProfileStatus>>): string {
  const copy = structuredClone(status);
  copy.as_of = "";
  return JSON.stringify(copy);
}

describe("global profile status cache", () => {
  it("skips a second read of the same depth", async () => {
    const context = await createInitializedTestContext("status-cache-fast");
    try {
      clearLiveReadCaches();
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      addResourceToPlugin(
        plugin.id,
        createResource({
          type: "instruction",
          name: "guide",
          description: "",
          content: "# guide",
          metadata: {},
          source: "manual",
        }).id,
      );
      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("work");

      const before = readDriftCoreComputeCount();
      const completions = readStatusRefreshCompletionCount();
      const full = await detectGlobalProfileStatus({ depth: "full", harness: "claude-code" });
      const fast = await detectGlobalProfileStatus({ depth: "fast", harness: "claude-code" });
      const fastAgain = await detectGlobalProfileStatus({ depth: "fast", harness: "claude-code" });
      expect(readDriftCoreComputeCount()).toBe(before);
      expect(readStatusRefreshCompletionCount() - completions).toBe(2);
      expect(Object.isFrozen(full.changes)).toBe(true);
      expect(() => {
        full.changes.push({ path: "x", type: "modified" });
      }).toThrow();
      expect(stable(fast)).toBe(stable(fastAgain));
      expect(fast.depth).toBe("fast");
      expect(fast.changes).toEqual(full.changes);
      expect(fast.has_drift).toBe(full.has_drift);
      expect(fast.stack_in_sync).toBe(full.stack_in_sync);
      expect(fast.panel.reasons).toContain("fast_depth");
      expect(fast.refreshing).toBe(false);
      expect(fastAgain.refreshing).toBe(false);
    } finally {
      clearLiveReadCaches();
      await context.cleanup();
    }
  });

  it("does not keep a cached status after an explicit clear when mtimes are unchanged", async () => {
    const context = await createInitializedTestContext("status-cache-clear");
    try {
      clearLiveReadCaches();
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      addResourceToPlugin(
        plugin.id,
        createResource({
          type: "instruction",
          name: "guide",
          description: "",
          content: "# guide",
          metadata: {},
          source: "manual",
        }).id,
      );
      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("work");
      const guide = join(context.homeDir, ".claude", "CLAUDE.md");
      const frozen = new Date("2020-06-01T00:00:00.000Z");
      utimesSync(guide, frozen, frozen);
      const first = await detectGlobalProfileStatus({ depth: "fast", harness: "claude-code" });
      markStatusCacheWatchersUnreliable();
      expect(first.has_drift).toBe(false);
      expect(first.changes).toEqual([]);
      const computed = readDriftCoreComputeCount();
      const completions = readStatusRefreshCompletionCount();

      const original = readFileSync(guide, "utf8");
      expect(original.includes("guide")).toBe(true);
      const edited = original.replace("guide", "GUIDE");
      expect(edited.length).toBe(original.length);
      writeFileSync(guide, edited);
      utimesSync(guide, frozen, frozen);
      expect(statSync(guide).mtimeMs).toBe(frozen.getTime());
      expect(statSync(guide).size).toBe(Buffer.byteLength(original));
      const cached = await detectGlobalProfileStatus({ depth: "fast", harness: "claude-code" });
      expect(cached.changes).toEqual([]);
      expect(readDriftCoreComputeCount()).toBe(computed);
      expect(readStatusRefreshCompletionCount()).toBe(completions);

      clearLiveReadCaches();
      const fresh = await detectGlobalProfileStatus({ depth: "fast", harness: "claude-code" });
      expect(readDriftCoreComputeCount()).toBe(computed);
      expect(readStatusRefreshCompletionCount()).toBe(completions + 1);
      expect(fresh.changes.some((change) => change.path.endsWith("CLAUDE.md"))).toBe(true);
      expect(fresh.refreshing).toBe(false);
    } finally {
      clearLiveReadCaches();
      await context.cleanup();
    }
  });

  it("serves the last status with refreshing set when an input mtime changes", async () => {
    const context = await createInitializedTestContext("status-cache-refresh");
    try {
      clearLiveReadCaches();
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      addResourceToPlugin(
        plugin.id,
        createResource({
          type: "instruction",
          name: "guide",
          description: "",
          content: "# guide",
          metadata: {},
          source: "manual",
        }).id,
      );
      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("work");
      const guide = join(context.homeDir, ".claude", "CLAUDE.md");
      const first = await detectGlobalProfileStatus({ depth: "fast", harness: "claude-code" });
      expect(first.refreshing).toBe(false);
      markStatusCacheWatchersUnreliable();
      const computed = readDriftCoreComputeCount();
      const refreshes = readStatusRefreshCompletionCount();

      writeFileSync(guide, `${readFileSync(guide, "utf8")}\nedit\n`);
      const during = await detectGlobalProfileStatus({ depth: "fast", harness: "claude-code" });
      expect(during.refreshing).toBe(true);
      expect(during.changes).toEqual(first.changes);

      const deadline = Date.now() + 8000;
      let fresh = during;
      while (Date.now() < deadline) {
        fresh = await detectGlobalProfileStatus({ depth: "fast", harness: "claude-code" });
        if (!fresh.refreshing && fresh.changes.some((change) => change.path.endsWith("CLAUDE.md"))) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      expect(fresh.refreshing).toBe(false);
      expect(fresh.changes.some((change) => change.path.endsWith("CLAUDE.md"))).toBe(true);
      expect(readStatusRefreshCompletionCount()).toBe(refreshes + 1);
      expect(readDriftCoreComputeCount()).toBe(computed);
    } finally {
      clearLiveReadCaches();
      await context.cleanup();
    }
  });

  it("marks the cache dirty when a watched file changes", async () => {
    const context = await createInitializedTestContext("status-cache-watch");
    try {
      clearLiveReadCaches();
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      addResourceToPlugin(
        plugin.id,
        createResource({
          type: "instruction",
          name: "guide",
          description: "",
          content: "# guide",
          metadata: {},
          source: "manual",
        }).id,
      );
      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      setActiveProfileName("work");
      const guide = join(context.homeDir, ".claude", "CLAUDE.md");
      await detectGlobalProfileStatus({ depth: "fast", harness: "claude-code" });
      const armDeadline = Date.now() + 2000;
      while (readStatusWatcherCreateCount() === 0 && Date.now() < armDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      const epoch = readStatusCacheEpoch();
      writeFileSync(guide, `${readFileSync(guide, "utf8")}\nwatched\n`);
      const deadline = Date.now() + 1500;
      while (readStatusCacheEpoch() === epoch && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(readStatusCacheEpoch()).toBeGreaterThan(epoch);
      const during = await detectGlobalProfileStatus({ depth: "fast", harness: "claude-code" });
      expect(during.refreshing).toBe(true);
      expect(during.changes).toEqual([]);
    } finally {
      clearLiveReadCaches();
      await context.cleanup();
    }
  });

  it("serves warm reads from cache until a status-relevant database write", async () => {
    const context = await createInitializedTestContext("status-cache-db-write");
    try {
      clearLiveReadCaches();
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      addResourceToPlugin(
        plugin.id,
        createResource({
          type: "instruction",
          name: "guide",
          description: "",
          content: "# guide",
          metadata: {},
          source: "manual",
        }).id,
      );
      setActiveProfileName("work");
      const cold = await detectGlobalProfileStatus({ depth: "full" });
      expect(cold.refreshing).toBe(false);
      const beforeCount = cold.contents?.resources.length ?? 0;

      // Ten warm reads after a cold read are all cache hits.
      const hitsBefore = readStatusCacheHitCount();
      const completionsBefore = readStatusRefreshCompletionCount();
      for (let index = 0; index < 10; index += 1) {
        const warm = await detectGlobalProfileStatus({ depth: "full" });
        expect(warm.refreshing).toBe(false);
        expect(stable(warm)).toBe(stable(cold));
      }
      expect(readStatusCacheHitCount()).toBe(hitsBefore + 10);
      expect(readStatusRefreshCompletionCount()).toBe(completionsBefore);

      // SQLite moves harnesstap.db, -wal, and -shm on reads and checkpoints.
      // Those stat changes alone are not a status change.
      const dbPath = getDbPath();
      const touched = new Date(Date.now() + 60_000);
      for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        if (existsSync(path)) utimesSync(path, touched, touched);
      }
      const touchHits = readStatusCacheHitCount();
      const afterTouch = await detectGlobalProfileStatus({ depth: "full" });
      expect(stable(afterTouch)).toBe(stable(cold));
      expect(readStatusCacheHitCount()).toBe(touchHits + 1);

      // A new library resource is not in any profile, so status does not
      // depend on it and the cache keeps serving.
      createResource({
        type: "skill",
        name: "library-only",
        description: "",
        content: "# library only\n",
        metadata: {},
        source: "manual",
      });
      const libraryHits = readStatusCacheHitCount();
      const libraryCompletions = readStatusRefreshCompletionCount();
      const afterLibrary = await detectGlobalProfileStatus({ depth: "full" });
      expect(stable(afterLibrary)).toBe(stable(cold));
      expect(readStatusCacheHitCount()).toBe(libraryHits + 1);
      expect(readStatusRefreshCompletionCount()).toBe(libraryCompletions);

      // Linking a resource into the active profile changes status: exactly
      // one recompute, then hits again.
      addResourceToPlugin(
        plugin.id,
        createResource({
          type: "skill",
          name: "from-db",
          description: "",
          content: "# from db\n",
          metadata: {},
          source: "manual",
        }).id,
      );
      const writeCompletions = readStatusRefreshCompletionCount();
      const writeMisses = readStatusCacheMissCount();
      const afterWrite = await detectGlobalProfileStatus({ depth: "full" });
      expect(afterWrite.refreshing).toBe(false);
      expect(afterWrite.contents?.resources.some((resource) => resource.name === "from-db")).toBe(true);
      expect(afterWrite.contents?.resources.length).toBe(beforeCount + 1);
      expect(readStatusRefreshCompletionCount()).toBe(writeCompletions + 1);
      expect(readStatusCacheMissCount()).toBe(writeMisses + 1);
      expect(readStatusCacheLastMissReason()).toBe("write");
      const againHits = readStatusCacheHitCount();
      for (let index = 0; index < 5; index += 1) {
        const warm = await detectGlobalProfileStatus({ depth: "full" });
        expect(stable(warm)).toBe(stable(afterWrite));
      }
      expect(readStatusCacheHitCount()).toBe(againHits + 5);
      expect(readStatusRefreshCompletionCount()).toBe(writeCompletions + 1);
    } finally {
      clearLiveReadCaches();
      await context.cleanup();
    }
  });

  it("recomputes once after another process commits to the database", async () => {
    const context = await createInitializedTestContext("status-cache-db-other-process");
    try {
      clearLiveReadCaches();
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      setActiveProfileName("work");
      const cold = await detectGlobalProfileStatus({ depth: "full" });
      const hits = readStatusCacheHitCount();
      await detectGlobalProfileStatus({ depth: "full" });
      expect(readStatusCacheHitCount()).toBe(hits + 1);

      // A second connection stands in for the CLI in another process.
      const other = new Database(getDbPath());
      other.exec("PRAGMA busy_timeout = 5000");
      other.prepare("UPDATE plugins SET description = ? WHERE id = ?").run("from cli", plugin.id);
      other.close();

      const completions = readStatusRefreshCompletionCount();
      const afterCommit = await detectGlobalProfileStatus({ depth: "full" });
      expect(afterCommit.refreshing).toBe(false);
      expect(readStatusRefreshCompletionCount()).toBe(completions + 1);
      expect(readStatusCacheLastMissReason()).toBe("data_version");
      const againHits = readStatusCacheHitCount();
      await detectGlobalProfileStatus({ depth: "full" });
      await detectGlobalProfileStatus({ depth: "full" });
      expect(readStatusCacheHitCount()).toBe(againHits + 2);
      expect(cold.refreshing).toBe(false);
    } finally {
      clearLiveReadCaches();
      await context.cleanup();
    }
  });
});
