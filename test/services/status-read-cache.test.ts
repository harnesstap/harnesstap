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

function stable(status: Awaited<ReturnType<typeof detectGlobalProfileStatus>>): string {
  const copy = structuredClone(status);
  copy.as_of = "";
  return JSON.stringify(copy);
}

describe("global profile status cache", () => {
  it("skips the dry-run on a second fast read and again after a full read", async () => {
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
      const full = await detectGlobalProfileStatus({ depth: "full", harness: "claude-code" });
      const fast = await detectGlobalProfileStatus({ depth: "fast", harness: "claude-code" });
      const fastAgain = await detectGlobalProfileStatus({ depth: "fast", harness: "claude-code" });
      expect(readDriftCoreComputeCount() - before).toBe(1);
      expect(stable(fast)).toBe(stable(fastAgain));
      expect(fast.depth).toBe("fast");
      expect(fast.changes).toEqual(full.changes);
      expect(fast.has_drift).toBe(full.has_drift);
      expect(fast.stack_in_sync).toBe(full.stack_in_sync);
      expect(fast.panel.reasons).toContain("fast_depth");
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
      expect(first.has_drift).toBe(false);
      expect(first.changes).toEqual([]);
      const computed = readDriftCoreComputeCount();

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

      clearLiveReadCaches();
      const fresh = await detectGlobalProfileStatus({ depth: "fast", harness: "claude-code" });
      expect(readDriftCoreComputeCount()).toBe(computed + 1);
      expect(fresh.changes.some((change) => change.path.endsWith("CLAUDE.md"))).toBe(true);
    } finally {
      clearLiveReadCaches();
      await context.cleanup();
    }
  });
});
