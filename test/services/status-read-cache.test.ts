import { readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
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
      await new Promise((resolve) => setTimeout(resolve, 30));
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
});
