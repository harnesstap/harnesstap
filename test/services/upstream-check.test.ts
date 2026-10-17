import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { getDb } from "../../src/db/connection.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import { setPluginUpstream } from "../../src/services/plugin-upstream.ts";
import {
  classifyUpstream,
  defaultFetchUpstreamLatest,
  dismissUpstreamUpdate,
  listUpstreamTargets,
  pickLatest,
  readUpstreamCheckSummary,
  readUpstreamChecks,
  runUpstreamCheck,
  type FetchUpstreamLatest,
  type UpstreamLatest,
} from "../../src/services/upstream-check.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("upstream-check-");
});

afterEach(async () => {
  await ctx.cleanup();
});

/** A mock catalog: base to answer. Records what was asked. */
function mockCatalog(answers: Record<string, UpstreamLatest>): FetchUpstreamLatest & { asked: string[][] } {
  const asked: string[][] = [];
  const fn = (async (items) => {
    asked.push(items.map((item) => item.base));
    return new Map(items.map((item) => [item.base, answers[item.base] ?? { ok: false, status: "unpublished", message: "nope" }]));
  }) as FetchUpstreamLatest & { asked: string[][] };
  fn.asked = asked;
  return fn;
}

function pulled(name: string, version: string, base = "acme/default/backend"): void {
  const plugin = createPlugin({ name, version, origin: "catalog", org_slug: "acme", catalog_slug: "default", tags: ["profile"] });
  getDb().prepare("UPDATE plugins SET origin_locator = ? WHERE id = ?").run(base, plugin.id);
}

function child(name: string, ref: string, kind: "extends" | "fork" = "extends", versionAtLink = "1.0.0"): void {
  const plugin = createPlugin({ name, tags: ["profile"] });
  setPluginUpstream(plugin.id, { kind, ref, version_at_link: versionAtLink });
}

describe("version picking", () => {
  it("separates the newest in range from a newer major", () => {
    expect(pickLatest(["1.0.0", "1.2.0", "1.10.1", "2.0.0", "3.1.0", "0.9.0"], "^1.0.0")).toEqual({
      latest_in_range: "1.10.1",
      latest_major: "3.1.0",
    });
    expect(pickLatest(["1.0.0"], "^1.0.0")).toEqual({ latest_in_range: "1.0.0", latest_major: "" });
  });

  it("classifies update before major, and current otherwise", () => {
    expect(classifyUpstream("1.0.0", { ok: true, latest_in_range: "1.2.0", latest_major: "2.0.0" }).status).toBe("update");
    expect(classifyUpstream("1.2.0", { ok: true, latest_in_range: "1.2.0", latest_major: "2.0.0" }).status).toBe("major");
    expect(classifyUpstream("1.2.0", { ok: true, latest_in_range: "1.2.0", latest_major: "" }).status).toBe("current");
    expect(
      classifyUpstream("1.0.0", { ok: false, status: "unreachable", message: "offline" }),
    ).toEqual({ status: "unreachable", latest_in_range: "", latest_major: "", message: "offline" });
  });
});

describe("runUpstreamCheck", () => {
  it("checks pulled packages and kept-in-sync children against the catalog in one batch", async () => {
    pulled("Backend engineer", "1.0.0");
    child("backend-qa", "acme/default/backend@^1.0.0");
    const fetchLatest = mockCatalog({
      "acme/default/backend": { ok: true, latest_in_range: "1.2.0", latest_major: "2.0.0" },
    });
    const report = await runUpstreamCheck({ fetchLatest });
    expect(fetchLatest.asked).toEqual([["acme/default/backend"]]);
    expect(report.rows.map((row) => [row.plugin_name, row.ref, row.local_version, row.status, row.latest_in_range, row.latest_major])).toEqual([
      ["Backend engineer", "acme/default/backend@^1.0.0", "1.0.0", "update", "1.2.0", "2.0.0"],
      ["backend-qa", "acme/default/backend@^1.0.0", "1.0.0", "update", "1.2.0", "2.0.0"],
    ]);
    expect(readUpstreamChecks()).toHaveLength(2);
  });

  it("reports a newer major as major, never as an update", async () => {
    pulled("Backend engineer", "1.2.0");
    const report = await runUpstreamCheck({
      fetchLatest: mockCatalog({ "acme/default/backend": { ok: true, latest_in_range: "1.2.0", latest_major: "2.0.0" } }),
    });
    expect(report.rows[0]).toMatchObject({ status: "major", latest_major: "2.0.0", local_version: "1.2.0" });
    expect(readUpstreamCheckSummary()).toMatchObject({ count: 0, major_count: 1 });
  });

  it("records unreachable and unpublished without failing", async () => {
    pulled("Backend engineer", "1.0.0");
    child("ops-qa", "acme/default/ops@^1.0.0");
    const report = await runUpstreamCheck({
      fetchLatest: mockCatalog({
        "acme/default/backend": { ok: false, status: "unreachable", message: "Cloud answered 503" },
      }),
    });
    expect(report.rows.map((row) => [row.plugin_name, row.status, row.message])).toEqual([
      ["Backend engineer", "unreachable", "Cloud answered 503"],
      ["ops-qa", "unpublished", "nope"],
    ]);
  });

  it("checks a local parent from the Library with no network call", async () => {
    createPlugin({ name: "backend", version: "1.0.0", tags: ["profile"] });
    child("backend-fork", "backend@^1.0.0", "fork");
    child("backend-qa", "backend@^1.0.0", "extends");
    createPlugin({ name: "backend", version: "1.1.0", tags: ["profile"] });
    const fetchLatest = mockCatalog({});
    const report = await runUpstreamCheck({ fetchLatest });
    expect(fetchLatest.asked).toEqual([[]]);
    expect(report.rows.map((row) => [row.plugin_name, row.local_version, row.status, row.latest_in_range])).toEqual([
      // A fork remembers the version it copied; the parent moved on.
      ["backend-fork", "1.0.0", "update", "1.1.0"],
      // Keep in sync already reads the newest installed parent.
      ["backend-qa", "1.1.0", "current", "1.1.0"],
    ]);
  });

  it("checks a pulled package once, from its newest installed version, and skips frozen cuts", async () => {
    pulled("Backend engineer", "1.0.0");
    pulled("Backend engineer", "1.1.0");
    getDb().prepare("UPDATE plugins SET frozen_at = 'x' WHERE version = '1.0.0'").run();
    pulled("Backend engineer", "1.0.1");
    expect(listUpstreamTargets()).toEqual([
      { plugin_name: "Backend engineer", ref: "acme/default/backend@^1.1.0", local_version: "1.1.0", kind: "catalog" },
    ]);
  });

  it("keeps Not now across runs and shows a newer version again", async () => {
    pulled("Backend engineer", "1.0.0");
    const at = (latest: string) =>
      mockCatalog({ "acme/default/backend": { ok: true, latest_in_range: latest, latest_major: "" } });
    await runUpstreamCheck({ fetchLatest: at("1.2.0") });
    expect(readUpstreamCheckSummary().count).toBe(1);

    const dismissed = dismissUpstreamUpdate("Backend engineer");
    expect(dismissed[0]?.dismissed_version).toBe("1.2.0");
    expect(readUpstreamCheckSummary().count).toBe(0);

    await runUpstreamCheck({ fetchLatest: at("1.2.0") });
    expect(readUpstreamChecks()[0]?.dismissed_version).toBe("1.2.0");
    expect(readUpstreamCheckSummary().count).toBe(0);

    await runUpstreamCheck({ fetchLatest: at("1.3.0") });
    expect(readUpstreamCheckSummary()).toMatchObject({
      count: 1,
      items: [{ plugin_name: "Backend engineer", latest_in_range: "1.3.0", status: "update" }],
    });
    expect(() => dismissUpstreamUpdate("nothing-here")).toThrow("No pending update for nothing-here.");
  });

  it("drops rows for links that are gone only on a full run", async () => {
    pulled("Backend engineer", "1.0.0");
    child("ops-qa", "acme/default/ops@^1.0.0");
    const fetchLatest = mockCatalog({});
    await runUpstreamCheck({ fetchLatest });
    getDb().prepare("UPDATE plugins SET upstream_kind = '', upstream_ref = '' WHERE name = 'ops-qa'").run();
    await runUpstreamCheck({ fetchLatest, name: "Backend engineer" });
    expect(readUpstreamChecks().map((row) => row.plugin_name)).toEqual(["Backend engineer", "ops-qa"]);
    await runUpstreamCheck({ fetchLatest });
    expect(readUpstreamChecks().map((row) => row.plugin_name)).toEqual(["Backend engineer"]);
  });
});

describe("defaultFetchUpstreamLatest", () => {
  const query = [{ base: "acme/default/backend", version: "1.0.0", range: "^1.0.0" }];

  it("uses the batched updates-since contract when Cloud has it", async () => {
    const calls: string[] = [];
    const spy = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return Response.json({
        items: [{ ref: "acme/default/backend", latest: "2.0.0", latest_in_range: "1.4.0", latest_major: "2.0.0" }],
      });
    }) as typeof fetch);
    try {
      const out = await defaultFetchUpstreamLatest(query, {});
      expect(out.get("acme/default/backend")).toEqual({ ok: true, latest_in_range: "1.4.0", latest_major: "2.0.0" });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("POST ");
      expect(calls[0]).toContain("/api/catalog/updates-since");
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to the catalog list while updates-since is not deployed", async () => {
    const calls: string[] = [];
    const spy = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/updates-since")) return new Response("not found", { status: 404 });
      return Response.json({
        plugins: [{ orgSlug: "acme", catalogSlug: "default", slug: "backend", name: "Backend", latestVersion: "1.3.0" }],
        nextCursor: null,
      });
    }) as typeof fetch);
    try {
      const out = await defaultFetchUpstreamLatest(query, {});
      expect(out.get("acme/default/backend")).toEqual({ ok: true, latest_in_range: "1.3.0", latest_major: "" });
      expect(calls.some((url) => url.includes("/api/public/plugins"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("marks every ref unreachable when Cloud cannot be reached", async () => {
    const spy = spyOn(globalThis, "fetch").mockImplementation((async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    try {
      const out = await defaultFetchUpstreamLatest(query, {});
      expect(out.get("acme/default/backend")).toMatchObject({ ok: false, status: "unreachable" });
    } finally {
      spy.mockRestore();
    }
  });
});
