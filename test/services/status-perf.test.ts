import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { addResourceToPlugin, createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { cursorStateDbPath, cursorUserDataDir } from "../../src/plugins/cursor-enablement.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import {
  detectGlobalProfileStatus,
  readDriftCoreComputeCount,
} from "../../src/services/global-profile-drift.ts";
import { clearLiveReadCaches } from "../../src/services/live-read-cache.ts";
import { statusCacheWatchersHealthy } from "../../src/services/status-read-cache.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

const SESSION_COUNT = 400;
const NOISE_ROWS = 400;
const NOISE_BYTES = 64 * 1024;
const RESOURCE_COUNT = 70;
/** Product warm target is at most 50ms. A healthy watcher hit is a map lookup. */
const WARM_BUDGET_MS = 50;
/** Product cold target is 200ms on a desktop. CI runners get headroom. */
const COLD_BUDGET_MS = 800;

function stable(status: Awaited<ReturnType<typeof detectGlobalProfileStatus>>): string {
  const copy = structuredClone(status);
  copy.as_of = "";
  return JSON.stringify(copy);
}

function writeLargeCursorHome(home: string): void {
  const logs = join(cursorUserDataDir(home), "logs");
  for (let index = 0; index < SESSION_COUNT; index += 1) {
    const dir = join(logs, `s${String(index).padStart(4, "0")}`, "window", "exthost");
    mkdirSync(dir, { recursive: true });
    for (let file = 0; file < 8; file += 1) {
      writeFileSync(join(dir, `editor${file}.log`), "noise\n");
    }
  }
  const newest = join(logs, "s9999", "window", "exthost", "output");
  mkdirSync(newest, { recursive: true });
  writeFileSync(join(newest, "Cursor Plugins.log"), "loadUserLocalPlugin demo loaded\n");

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
}

describe("status perf", () => {
  it("keeps a warm status under budget on a large Cursor home", async () => {
    const context = await createInitializedTestContext("status-perf");
    try {
      clearLiveReadCaches();
      writeLargeCursorHome(context.homeDir);
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
      const coldStarted = performance.now();
      const cold = await detectGlobalProfileStatus({ depth: "full" });
      const coldMs = performance.now() - coldStarted;
      const warmStarted = performance.now();
      const warm = await detectGlobalProfileStatus({ depth: "full" });
      const warmMs = performance.now() - warmStarted;
      console.log(
        `status perf cold=${coldMs.toFixed(1)}ms warm=${warmMs.toFixed(1)}ms`,
      );

      expect(coldMs).toBeLessThan(COLD_BUDGET_MS);
      expect(warmMs).toBeLessThan(WARM_BUDGET_MS);
      expect(cold.refreshing).toBe(false);
      expect(warm.refreshing).toBe(false);
      expect(statusCacheWatchersHealthy()).toBe(true);
      expect(stable(warm)).toBe(stable(cold));
      expect(readDriftCoreComputeCount() - before).toBe(1);
      expect(cold.contents?.resources.length).toBe(RESOURCE_COUNT);
    } finally {
      clearLiveReadCaches();
      await context.cleanup();
    }
  });
});
