import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { getDb } from "../../src/db/connection.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import * as originUpdate from "../../src/services/plugin-origin-update.ts";
import {
  readUpstreamChecks,
  upstreamCheckDeps,
  type FetchUpstreamLatest,
} from "../../src/services/upstream-check.ts";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;
const realFetchLatest = upstreamCheckDeps.fetchLatest;
let originSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
  ctx = await createInitializedTestContext("cli-plugin-check-upstream-");
  originSpy = spyOn(originUpdate, "checkPluginOrigins").mockResolvedValue({ results: [] });
  upstreamCheckDeps.fetchLatest = (async (items) =>
    new Map(items.map((item) => [item.base, { ok: true, latest_in_range: "1.2.0", latest_major: "2.0.0" }]))) as FetchUpstreamLatest;
});

afterEach(async () => {
  upstreamCheckDeps.fetchLatest = realFetchLatest;
  originSpy.mockRestore();
  await ctx.cleanup();
});

function pulled(version: string): void {
  const plugin = createPlugin({ name: "Backend engineer", version, origin: "catalog", org_slug: "acme", catalog_slug: "default" });
  getDb().prepare("UPDATE plugins SET origin_locator = 'acme/default/backend' WHERE id = ?").run(plugin.id);
}

describe("ht plugin check writes the upstream table", () => {
  it("returns the upstream rows in JSON and stores them", async () => {
    pulled("1.0.0");
    const result = await runCli(["plugin", "check", "--format", "json"]);
    expect(result.exitCode ?? 0).toBe(0);
    const payload = JSON.parse(result.stdout) as { upstream: Array<{ plugin_name: string; status: string }> };
    expect(payload.upstream).toMatchObject([{ plugin_name: "Backend engineer", status: "update", latest_in_range: "1.2.0" }]);
    expect(readUpstreamChecks()).toMatchObject([{ plugin_name: "Backend engineer", status: "update" }]);
  });

  it("prints an UPSTREAM table and labels a major as not installed automatically", async () => {
    pulled("1.2.0");
    const result = await runCli(["plugin", "check"]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toContain("UPSTREAM");
    expect(result.stdout).toContain("2.0.0 (major)");
    expect(result.stdout).toContain("A major version is never installed automatically.");
  });

  it("leaves the exit code alone when Cloud is unreachable", async () => {
    pulled("1.0.0");
    upstreamCheckDeps.fetchLatest = (async (items) =>
      new Map(items.map((item) => [item.base, { ok: false, status: "unreachable", message: "offline" }]))) as FetchUpstreamLatest;
    const result = await runCli(["plugin", "check", "--format", "json"]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(readUpstreamChecks()[0]).toMatchObject({ status: "unreachable", message: "offline" });
  });
});
