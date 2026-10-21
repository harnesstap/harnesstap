import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb } from "../../src/db/connection.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import { setPluginUpstream } from "../../src/services/plugin-upstream.ts";
import {
  addNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  parseAge,
  unreadNotificationCount,
} from "../../src/services/notifications.ts";
import {
  dismissUpstreamUpdate,
  runUpstreamCheck,
  type FetchUpstreamLatest,
  type UpstreamLatest,
} from "../../src/services/upstream-check.ts";
import {
  CHECK_FAILURE_NOTIFY_AFTER,
  resetCheckFailureStreakForTests,
  setUpstreamCheckRunnerForTests,
  startUpstreamCheckJob,
} from "../../src/services/upstream-check-runner.ts";
import {
  handleNotificationsPruneCommand,
  handleNotificationsReadCommand,
} from "../../src/cli/handlers/notifications.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  ctx = await createInitializedTestContext("notifications-");
  resetCheckFailureStreakForTests();
});

afterEach(async () => {
  setUpstreamCheckRunnerForTests(null);
  resetCheckFailureStreakForTests();
  await ctx.cleanup();
});

function catalog(answers: Record<string, UpstreamLatest>): FetchUpstreamLatest {
  return async (items) => new Map(items.map((item) => [item.base, answers[item.base] ?? { ok: false, status: "unreachable", message: "offline" }]));
}

function pulled(name: string, version: string, base = "acme/default/backend"): void {
  const plugin = createPlugin({ name, version, origin: "catalog", org_slug: "acme", catalog_slug: "default", tags: ["profile"] });
  getDb().prepare("UPDATE plugins SET origin_locator = ? WHERE id = ?").run(base, plugin.id);
}

function old(id: string, days: number): void {
  const at = new Date(Date.now() - days * DAY).toISOString();
  getDb().prepare("UPDATE notifications SET created_at = ? WHERE id = ?").run(at, id);
}

describe("notifications service", () => {
  it("lists notifications written in the same millisecond newest first", () => {
    const at = "2026-10-21T00:00:00.000Z";
    const insert = getDb().prepare(
      "INSERT INTO notifications (id, kind, title, body, plugin_name, payload, created_at) VALUES (?, 'update_available', ?, '', 'p', ?, ?)",
    );
    // The later write gets the smaller id, as a ULID can inside one millisecond.
    insert.run("01ZZZZZZZZZZZZZZZZZZZZZZZZ", "first", JSON.stringify({ version: "1.0.0" }), at);
    insert.run("01AAAAAAAAAAAAAAAAAAAAAAAA", "second", JSON.stringify({ version: "1.1.0" }), at);
    expect(listNotifications().map((n) => n.title)).toEqual(["second", "first"]);

    const now = new Date("2026-10-22T00:00:00.000Z");
    const versions = Array.from({ length: 20 }, (_, i) => `2.${i}.0`);
    for (const version of versions) {
      addNotification({ kind: "update_available", title: version, plugin_name: "q", payload: { version }, now });
    }
    expect(listNotifications({ limit: 20 }).map((n) => n.title)).toEqual([...versions].reverse());
  });

  it("writes the same kind, plugin and version once", () => {
    const first = addNotification({ kind: "update_available", plugin_name: "lint", title: "lint 1.2.0", payload: { version: "1.2.0" } });
    const again = addNotification({ kind: "update_available", plugin_name: "lint", title: "lint 1.2.0 again", payload: { version: "1.2.0" } });
    const other = addNotification({ kind: "auto_installed", plugin_name: "lint", title: "lint updated", payload: { version: "1.2.0" } });
    expect(first).not.toBeNull();
    expect(again).toBeNull();
    expect(other).not.toBeNull();
    expect(listNotifications().map((n) => n.title).sort()).toEqual(["lint 1.2.0", "lint updated"]);
  });

  it("marks one or all as read and keeps read ones under --all", () => {
    const a = addNotification({ kind: "update_available", plugin_name: "a", title: "a", payload: { version: "1.1.0" } })!;
    addNotification({ kind: "update_available", plugin_name: "b", title: "b", payload: { version: "1.1.0" } });
    addNotification({ kind: "update_available", plugin_name: "c", title: "c", payload: { version: "1.1.0" } });
    expect(unreadNotificationCount()).toBe(3);
    expect(markNotificationRead(a.id)?.read_at).toBeTruthy();
    expect(markNotificationRead("missing")).toBeNull();
    expect(unreadNotificationCount()).toBe(2);
    expect(markAllNotificationsRead()).toBe(2);
    expect(unreadNotificationCount()).toBe(0);
    expect(listNotifications()).toEqual([]);
    expect(listNotifications({ filter: "all" })).toHaveLength(3);
  });

  it("parses ages in hours, days and weeks only", () => {
    expect(parseAge("12h")).toBe(12 * 60 * 60 * 1000);
    expect(parseAge("90d")).toBe(90 * DAY);
    expect(parseAge("2w")).toBe(14 * DAY);
    expect(parseAge("0d")).toBeNull();
    expect(parseAge("3m")).toBeNull();
  });
});

describe("prune", () => {
  function seed(): string[] {
    const ids = ["old-read", "old-unread", "new-read"].map(
      (title) => addNotification({ kind: "update_available", plugin_name: title, title, payload: { version: "1.1.0" } })!.id,
    );
    old(ids[0]!, 120);
    old(ids[1]!, 120);
    markNotificationRead(ids[0]!);
    markNotificationRead(ids[2]!);
    return ids;
  }

  it("deletes nothing without --yes when it cannot ask", async () => {
    seed();
    await expect(
      handleNotificationsPruneCommand({ olderThan: "90d" }, { interactive: false, choose: async () => "delete" as never }),
    ).rejects.toThrow("Pass --yes to confirm.");
    expect(listNotifications({ filter: "all" })).toHaveLength(3);
  });

  it("deletes nothing when the prompt is answered Cancel", async () => {
    seed();
    await handleNotificationsPruneCommand({ olderThan: "90d" }, { interactive: true, choose: async () => "cancel" as never });
    expect(listNotifications({ filter: "all" })).toHaveLength(3);
  });

  it("deletes only read notifications older than the age, after confirmation", async () => {
    seed();
    await handleNotificationsPruneCommand({ olderThan: "90d" }, { interactive: true, choose: async () => "delete" as never });
    expect(listNotifications({ filter: "all" }).map((n) => n.title).sort()).toEqual(["new-read", "old-unread"]);
  });

  it("never runs on its own: reading, marking and checking keep every row", async () => {
    seed();
    handleNotificationsReadCommand(undefined, { all: true, format: "json" });
    await runUpstreamCheck({ fetchLatest: catalog({}) });
    expect(listNotifications({ filter: "all" })).toHaveLength(3);
  });
});

describe("producers", () => {
  it("notifies an available update once per version, and not for a version set aside", async () => {
    pulled("Backend engineer", "1.0.0");
    const v12 = catalog({ "acme/default/backend": { ok: true, latest_in_range: "1.2.0", latest_major: "" } });
    await runUpstreamCheck({ fetchLatest: v12 });
    await runUpstreamCheck({ fetchLatest: v12 });
    expect(listNotifications().map((n) => [n.kind, n.plugin_name, n.title, n.payload.version, n.payload.major])).toEqual([
      ["update_available", "Backend engineer", "Backend engineer 1.2.0 is available", "1.2.0", false],
    ]);

    await runUpstreamCheck({ fetchLatest: catalog({ "acme/default/backend": { ok: true, latest_in_range: "1.3.0", latest_major: "" } }) });
    expect(listNotifications().map((n) => n.payload.version)).toEqual(["1.3.0", "1.2.0"]);

    dismissUpstreamUpdate("Backend engineer");
    await runUpstreamCheck({ fetchLatest: catalog({ "acme/default/backend": { ok: true, latest_in_range: "1.3.0", latest_major: "" } }) });
    expect(listNotifications()).toHaveLength(2);
  });

  it("tells an extends child that its parent published, and labels a major", async () => {
    const plugin = createPlugin({ name: "backend-qa", tags: ["profile"] });
    setPluginUpstream(plugin.id, { kind: "extends", ref: "acme/default/backend@^1.0.0", version_at_link: "1.0.0" });
    await runUpstreamCheck({
      fetchLatest: catalog({ "acme/default/backend": { ok: true, latest_in_range: "1.0.0", latest_major: "2.0.0" } }),
    });
    const [row] = listNotifications();
    expect([row?.kind, row?.plugin_name, row?.title, row?.payload.major]).toEqual([
      "parent_published",
      "backend-qa",
      "acme/default/backend published 2.0.0",
      true,
    ]);
    expect(row?.body).toBe("Major update, needs your OK. You have 1.0.0.");
  });

  it("tells a synced child when its local parent moves to a new version", async () => {
    const parent = createPlugin({ name: "backend", version: "1.0.0", tags: ["profile"] });
    const plugin = createPlugin({ name: "backend-qa", tags: ["profile"] });
    setPluginUpstream(plugin.id, { kind: "extends", ref: "backend@^1.0.0", version_at_link: "1.0.0" });
    await runUpstreamCheck({ fetchLatest: catalog({}) });
    expect(listNotifications()).toEqual([]);

    getDb().prepare("UPDATE plugins SET version = '1.1.0' WHERE id = ?").run(parent.id);
    await runUpstreamCheck({ fetchLatest: catalog({}) });
    await runUpstreamCheck({ fetchLatest: catalog({}) });
    expect(listNotifications().map((n) => [n.kind, n.plugin_name, n.title, n.body])).toEqual([
      ["parent_published", "backend-qa", "backend-qa now uses 1.1.0", "Synced from backend (was 1.0.0)."],
    ]);
  });

  it("notifies once after repeated failed checks, and a success resets the streak", async () => {
    setUpstreamCheckRunnerForTests(async () => {
      throw new Error("catalog offline");
    });
    for (let i = 0; i < CHECK_FAILURE_NOTIFY_AFTER - 1; i++) {
      await startUpstreamCheckJob().promise.catch(() => {});
    }
    expect(listNotifications()).toEqual([]);
    await startUpstreamCheckJob().promise.catch(() => {});
    await startUpstreamCheckJob().promise.catch(() => {});
    const failures = listNotifications();
    expect(failures.map((n) => [n.kind, n.title])).toEqual([["check_failed", "Checking for plugin updates keeps failing"]]);
    expect(failures[0]?.body).toContain("catalog offline");

    setUpstreamCheckRunnerForTests(async () => ({ checked_at: new Date().toISOString(), rows: [] }));
    await startUpstreamCheckJob().promise;
    getDb().exec("DELETE FROM notifications");
    setUpstreamCheckRunnerForTests(async () => {
      throw new Error("catalog offline");
    });
    await startUpstreamCheckJob().promise.catch(() => {});
    expect(listNotifications()).toEqual([]);
  });
});
