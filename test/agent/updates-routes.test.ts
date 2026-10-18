import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { tryHandle } from "../../src/agent/parity-handlers/updates.ts";
import { getDb } from "../../src/db/connection.ts";
import { addDependencyToPlugin, createPlugin } from "../../src/models/plugin-model.ts";
import { setPluginUpstream } from "../../src/services/plugin-upstream.ts";
import {
  resetUpstreamScheduleForTests,
  setUpstreamCheckRunnerForTests,
  startUpstreamCheckSchedule,
  upstreamCheckScheduleEnabled,
} from "../../src/services/upstream-check-runner.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

const TOKEN = "test-token";
const DEPS = { isAgentSwitchInProgress: () => false };
let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("updates-routes-");
});

afterEach(async () => {
  setUpstreamCheckRunnerForTests(null);
  resetUpstreamScheduleForTests();
  await ctx.cleanup();
});

async function handle(method: string, path: string, body?: unknown, token: string | null = TOKEN): Promise<Response> {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await tryHandle(
    new Request(`http://127.0.0.1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    TOKEN,
    DEPS,
  );
  if (!response) throw new Error(`no route for ${method} ${path}`);
  return response;
}

function row(plugin: string, ref: string, status: string, latest = "1.2.0", major = ""): void {
  getDb()
    .prepare(
      `INSERT INTO upstream_checks (plugin_name, ref, local_version, latest_in_range, latest_major, status, checked_at)
       VALUES (?, ?, '1.0.0', ?, ?, ?, datetime())`,
    )
    .run(plugin, ref, latest, major, status);
}

describe("updates API", () => {
  it("lists rows with kind, pending and the profiles that use the plugin", async () => {
    const pulled = createPlugin({ name: "web-search", origin: "catalog", org_slug: "acme", catalog_slug: "default" });
    getDb().prepare("UPDATE plugins SET origin_locator = 'acme/default/web-search' WHERE id = ?").run(pulled.id);
    const team = createPlugin({ name: "team", tags: ["profile"] });
    addDependencyToPlugin(team.id, "web-search", "*");
    createPlugin({ name: "solo", tags: ["profile"] });
    const fork = createPlugin({ name: "backend-copy", tags: ["profile"] });
    setPluginUpstream(fork.id, { kind: "fork", ref: "backend@^1.0.0", version_at_link: "1.0.0" });
    row("web-search", "acme/default/web-search@^1.0.0", "update");
    row("backend-copy", "backend@^1.0.0", "update", "1.1.0");
    row("ops", "acme/default/ops@^1.0.0", "current", "1.0.0");

    const response = await handle("GET", "/v1/updates");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      rows: Array<{ plugin_name: string; kind: string; pending: boolean; profiles: string[] }>;
      summary: { count: number };
    };
    expect(body.summary.count).toBe(2);
    expect(body.rows.map((entry) => [entry.plugin_name, entry.kind, entry.pending, entry.profiles])).toEqual([
      ["backend-copy", "fork", true, ["backend-copy"]],
      ["ops", "unknown", false, []],
      ["web-search", "catalog", true, ["team"]],
    ]);
  });

  it("dismisses at the offered version and refuses a plugin with nothing pending", async () => {
    row("web-search", "acme/default/web-search@^1.0.0", "update");
    const response = await handle("POST", "/v1/updates/web-search/dismiss", {});
    expect(response.status).toBe(200);
    const body = (await response.json()) as { rows: Array<{ dismissed_version: string; pending: boolean }>; summary: { count: number } };
    expect(body.rows[0]).toMatchObject({ dismissed_version: "1.2.0", pending: false });
    expect(body.summary.count).toBe(0);
    expect((await handle("POST", "/v1/updates/nothing/dismiss", {})).status).toBe(404);
    expect((await handle("POST", "/v1/updates/web-search/dismiss", { version: 3 })).status).toBe(400);
  });

  it("starts one check at a time and reports the job", async () => {
    let release: () => void = () => {};
    let runs = 0;
    setUpstreamCheckRunnerForTests(async () => {
      runs += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { checked_at: "now", rows: [] };
    });
    const first = await handle("POST", "/v1/updates/check");
    expect(first.status).toBe(202);
    const { job_id } = (await first.json()) as { job_id: string };
    const second = (await (await handle("POST", "/v1/updates/check")).json()) as { job_id: string };
    expect(second.job_id).toBe(job_id);
    expect(runs).toBe(1);
    expect(((await (await handle("GET", `/v1/updates/check/${job_id}`)).json()) as { state: string }).state).toBe("running");
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(((await (await handle("GET", `/v1/updates/check/${job_id}`)).json()) as { state: string }).state).toBe("done");
    expect((await handle("GET", "/v1/updates/check/missing")).status).toBe(404);
  });

  it("requires the token", async () => {
    expect((await handle("GET", "/v1/updates", undefined, null)).status).toBe(401);
    expect((await handle("POST", "/v1/updates/check", undefined, null)).status).toBe(401);
  });
});

describe("update check schedule", () => {
  it("checks on the first tick, ticks again without re-checking before it is due, and stops", async () => {
    let runs = 0;
    setUpstreamCheckRunnerForTests(async () => {
      runs += 1;
      return { checked_at: "now", rows: [] };
    });
    const stop = startUpstreamCheckSchedule({ initialDelayMs: 5, intervalMs: 10 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    stop();
    expect(runs).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runs).toBe(1);
  });

  it("is off with HARNESSTAP_UPDATE_CHECK=off", () => {
    expect(upstreamCheckScheduleEnabled({ HARNESSTAP_UPDATE_CHECK: "off" })).toBe(false);
    expect(upstreamCheckScheduleEnabled({})).toBe(true);
  });
});
