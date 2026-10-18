import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_UPDATE_SETTINGS,
  loadSettings,
  loadUpdateSettings,
  saveUpdateSettings,
} from "../../src/config/settings.ts";
import { getDb, getHarnesstapDir } from "../../src/db/connection.ts";
import {
  resetUpstreamScheduleForTests,
  runScheduledUpstreamCheck,
  setUpstreamCheckRunnerForTests,
  upstreamCheckDue,
} from "../../src/services/upstream-check-runner.ts";
import {
  upstreamUpdateLockPath,
  UpstreamUpdateLockBusyError,
  withUpstreamUpdateLock,
} from "../../src/services/upstream-update-lock.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;
let runs = 0;
let installs = 0;

beforeEach(async () => {
  ctx = await createInitializedTestContext("upstream-schedule-");
  runs = 0;
  installs = 0;
  setUpstreamCheckRunnerForTests(
    async () => {
      runs += 1;
      return { checked_at: new Date().toISOString(), rows: [] };
    },
    async () => {
      installs += 1;
      return [];
    },
  );
});

afterEach(async () => {
  setUpstreamCheckRunnerForTests(null);
  resetUpstreamScheduleForTests();
  await ctx.cleanup();
});

const configPath = () => join(getHarnesstapDir(), "config.json");
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("updates settings", () => {
  it("defaults to notify, daily, not prompted, so auto-install is off", () => {
    expect(DEFAULT_UPDATE_SETTINGS).toEqual({ mode: "notify", frequency: "daily", prompted: false });
    expect(loadUpdateSettings(getHarnesstapDir())).toEqual(DEFAULT_UPDATE_SETTINGS);
  });

  it("ignores unknown values and keeps the other keys when it saves", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({ telemetry: { enabled: false }, updates: { mode: "always", frequency: "monthly", prompted: "yes" } }),
    );
    expect(loadSettings(getHarnesstapDir()).updates).toEqual(DEFAULT_UPDATE_SETTINGS);
    expect(saveUpdateSettings(getHarnesstapDir(), { mode: "install", frequency: "weekly" })).toEqual({
      mode: "install",
      frequency: "weekly",
      prompted: false,
    });
    const written = JSON.parse(readFileSync(configPath(), "utf8"));
    expect(written.telemetry).toEqual({ enabled: false });
    expect(written.updates).toEqual({ mode: "install", frequency: "weekly", prompted: false });
  });
});

describe("schedule", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

  it("is due by frequency, never in off mode", () => {
    const s = (mode: "off" | "notify" | "install", frequency: "hourly" | "daily" | "weekly") => ({ mode, frequency, prompted: false });
    expect(upstreamCheckDue(s("notify", "daily"), null, now)).toBe(true);
    expect(upstreamCheckDue(s("notify", "daily"), hoursAgo(23), now)).toBe(false);
    expect(upstreamCheckDue(s("notify", "daily"), hoursAgo(24), now)).toBe(true);
    expect(upstreamCheckDue(s("notify", "hourly"), hoursAgo(1), now)).toBe(true);
    expect(upstreamCheckDue(s("install", "weekly"), hoursAgo(24 * 6), now)).toBe(false);
    expect(upstreamCheckDue(s("off", "hourly"), null, now)).toBe(false);
  });

  it("checks in notify mode without installing, and not again before it is due", async () => {
    expect(runScheduledUpstreamCheck()).not.toBeNull();
    await settle();
    expect([runs, installs]).toEqual([1, 0]);
    expect(runScheduledUpstreamCheck()).toBeNull();
  });

  it("measures from the newest stored check, so a restart does not re-check", () => {
    getDb()
      .prepare(
        "INSERT INTO upstream_checks (plugin_name, ref, local_version, status, checked_at) VALUES ('a', 'a@^1.0.0', '1.0.0', 'current', ?)",
      )
      .run(new Date(Date.now() - 3600_000).toISOString());
    expect(runScheduledUpstreamCheck()).toBeNull();
    expect(runs).toBe(0);
  });

  it("installs only in install mode, and does nothing in off mode", async () => {
    saveUpdateSettings(getHarnesstapDir(), { mode: "off" });
    expect(runScheduledUpstreamCheck()).toBeNull();
    saveUpdateSettings(getHarnesstapDir(), { mode: "install" });
    const job = runScheduledUpstreamCheck();
    await settle();
    expect([runs, installs]).toEqual([1, 1]);
    expect(job?.state).toBe("done");
  });

  it("skips a scheduled run while another plugin update holds the lock", async () => {
    // PID 1 is always alive, so the lock is not stale.
    writeFileSync(upstreamUpdateLockPath(), "1\n");
    const job = runScheduledUpstreamCheck();
    await settle();
    expect(runs).toBe(0);
    expect(job?.skipped).toBe("another plugin update is running");
    expect(existsSync(upstreamUpdateLockPath())).toBe(true);
  });
});

describe("upstream update lock", () => {
  it("fails fast when busy, waits when asked, and clears a lock left by a dead process", async () => {
    writeFileSync(upstreamUpdateLockPath(), "1\n");
    await expect(withUpstreamUpdateLock(async () => "x")).rejects.toBeInstanceOf(UpstreamUpdateLockBusyError);

    let waited = false;
    setTimeout(() => writeFileSync(upstreamUpdateLockPath(), "999999999\n"), 30);
    const value = await withUpstreamUpdateLock(async () => "ran", {
      waitMs: 2000,
      pollMs: 10,
      onWait: () => {
        waited = true;
      },
    });
    expect([value, waited]).toEqual(["ran", true]);
    expect(existsSync(upstreamUpdateLockPath())).toBe(false);
  });

  it("is re-entrant in one process", async () => {
    const value = await withUpstreamUpdateLock(() => withUpstreamUpdateLock(async () => "inner"));
    expect(value).toBe("inner");
    expect(existsSync(upstreamUpdateLockPath())).toBe(false);
  });
});
