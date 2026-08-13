import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { tryHandle } from "../../src/agent/parity-handlers/resource-mutate.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import {
  createResource,
  getResource,
  listResources,
} from "../../src/models/resource.ts";
import { ensurePluginResource } from "../../src/services/plugin-composition.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";

const TOKEN = "test-token";
const FIXTURE = join(import.meta.dirname, "../fixtures/plugin-import/cursor-team-kit");
const DEPS = { isAgentSwitchInProgress: () => false };

let ctx: TestContext;

afterEach(async () => {
  await ctx?.cleanup();
});

async function withHome(prefix: string): Promise<TestContext> {
  ctx = await createInitializedTestContext(prefix);
  return ctx;
}

function authHeaders(token = TOKEN): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

function seedLinkedSkill(homeDir: string, content: string) {
  const installRoot = join(
    homeDir,
    ".claude",
    "plugins",
    "cache",
    "fixture-mkt",
    "cursor-team-kit",
  );
  mkdirSync(join(installRoot, ".."), { recursive: true });
  cpSync(FIXTURE, installRoot, { recursive: true });
  return createResource({
    type: "skill",
    name: "team",
    namespace: "cursor-team-kit",
    description: "cached",
    content,
    metadata: {},
    source: "marketplace",
    origin_kind: "marketplace_link",
    origin_ref: "cursor-team-kit@fixture-mkt",
  });
}

async function handle(
  method: string,
  path: string,
  init: { token?: string; body?: unknown; headers?: HeadersInit } = {},
): Promise<Response | null> {
  const headers = new Headers(init.headers ?? authHeaders(init.token ?? TOKEN));
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  const request = new Request(`http://127.0.0.1${path}`, {
    method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return tryHandle(request, TOKEN, DEPS);
}

describe("tryHandle resource-mutate", () => {
  it("returns null for unrelated paths including tracked-dir routes", async () => {
    await withHome("parity-mutate-null");
    expect(
      await handle("GET", "/v1/library/resource-directories"),
    ).toBeNull();
    expect(
      await handle("POST", "/v1/library/resource-directories/rescan"),
    ).toBeNull();
    expect(await handle("GET", "/v1/health")).toBeNull();
  });

  it("returns 401 without bearer on POST sync and DELETE", async () => {
    await withHome("parity-mutate-401");
    const sync = await handle(
      "POST",
      "/v1/library/resources/skill%3Aship/sync",
      { headers: {} },
    );
    expect(sync?.status).toBe(401);
    const del = await handle("DELETE", "/v1/library/resources/skill%3Aship", {
      headers: {},
    });
    expect(del?.status).toBe(401);
  });

  it("DELETE returns 200 then the row is gone", async () => {
    await withHome("parity-mutate-delete-ok");
    const resource = createResource({
      type: "skill",
      name: "ship",
      description: "Ship",
      content: "# ship",
      metadata: {},
      source: "manual",
    });
    const response = await handle(
      "DELETE",
      `/v1/library/resources/${encodeURIComponent(resource.id)}`,
    );
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      deleted: boolean;
      resource: { id: string; name: string };
    };
    expect(body.deleted).toBe(true);
    expect(body.resource.id).toBe(resource.id);
    expect(getResource(resource.id)).toBeUndefined();
  });

  it("DELETE unknown selector returns 404", async () => {
    await withHome("parity-mutate-delete-404");
    const response = await handle(
      "DELETE",
      "/v1/library/resources/skill%3Amissing",
    );
    expect(response?.status).toBe(404);
    const body = (await response?.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("DELETE untracked selector returns 404 and does not delete files", async () => {
    await withHome("parity-mutate-untracked");
    const response = await handle(
      "DELETE",
      `/v1/library/resources/${encodeURIComponent("untracked:instruction:claude")}`,
    );
    expect(response?.status).toBe(404);
  });

  it("DELETE ambiguous name returns 409 with matches", async () => {
    await withHome("parity-mutate-ambiguous");
    createResource({
      type: "skill",
      name: "dup",
      namespace: "a",
      description: "a",
      content: "# a",
      metadata: {},
      source: "manual",
    });
    createResource({
      type: "skill",
      name: "dup",
      namespace: "b",
      description: "b",
      content: "# b",
      metadata: {},
      source: "manual",
    });
    const response = await handle("DELETE", "/v1/library/resources/skill%3Adup");
    expect(response?.status).toBe(409);
    const body = (await response?.json()) as {
      error: string;
      matches: unknown[];
    };
    expect(body.error).toBe("ambiguous");
    expect(body.matches.length).toBe(2);
  });

  it("POST sync dry_run does not change content", async () => {
    const home = await withHome("parity-mutate-dry");
    const before = seedLinkedSkill(home.homeDir, "# stale cache\n");
    const response = await handle(
      "POST",
      `/v1/library/resources/${encodeURIComponent(before.id)}/sync`,
      { body: { dry_run: true, on_conflict: "fail" } },
    );
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      dry_run: boolean;
      updated: Array<{ id: string }>;
      checked: number;
    };
    expect(body.dry_run).toBe(true);
    expect(body.updated.length).toBe(1);
    expect(getResource(before.id)?.content).toBe("# stale cache\n");
  });

  it("POST sync default fail returns 409 resource_conflict; overwrite succeeds", async () => {
    const home = await withHome("parity-mutate-conflict");
    const before = seedLinkedSkill(home.homeDir, "# stale cache\n");
    const failed = await handle(
      "POST",
      `/v1/library/resources/${encodeURIComponent(before.id)}/sync`,
      { body: { dry_run: false } },
    );
    expect(failed?.status).toBe(409);
    const failedBody = (await failed?.json()) as { error: string; message: string };
    expect(failedBody.error).toBe("resource_conflict");
    expect(failedBody.message).toMatch(/Resource conflict/);
    expect(getResource(before.id)?.content).toBe("# stale cache\n");

    const ok = await handle(
      "POST",
      `/v1/library/resources/${encodeURIComponent(before.id)}/sync`,
      { body: { dry_run: false, on_conflict: "overwrite" } },
    );
    expect(ok?.status).toBe(200);
    expect(getResource(before.id)?.content).toContain("shared team review checklist");
  });

  it("POST sync non-object JSON returns 400 invalid_json", async () => {
    await withHome("parity-mutate-bad-json");
    const response = await handle(
      "POST",
      "/v1/library/resources/skill%3Aship/sync",
      { body: [] },
    );
    expect(response?.status).toBe(400);
    const body = (await response?.json()) as { error: string };
    expect(body.error).toBe("invalid_json");
  });

  it("POST sync invalid on_conflict returns 400", async () => {
    await withHome("parity-mutate-bad-policy");
    const response = await handle(
      "POST",
      "/v1/library/resources/skill%3Aship/sync",
      { body: { on_conflict: "explode" } },
    );
    expect(response?.status).toBe(400);
    const body = (await response?.json()) as { error: string };
    expect(body.error).toBe("invalid_on_conflict");
  });

  it("POST sync empty selector returns 400 invalid_selector", async () => {
    await withHome("parity-mutate-empty");
    const response = await handle("POST", "/v1/library/resources/%20/sync");
    expect(response?.status).toBe(400);
    const body = (await response?.json()) as { error: string };
    expect(body.error).toBe("invalid_selector");
  });

  it("POST sync authored plugin returns 400 sync_not_allowed", async () => {
    await withHome("parity-mutate-authored");
    createPlugin({ name: "mine", version: "1.0.0" });
    ensurePluginResource("plugin:mine");
    const pluginRow = listResources({
      type: "plugin",
      includeComposition: true,
    }).find((row) => row.name === "mine");
    expect(pluginRow).toBeTruthy();
    const response = await handle(
      "POST",
      `/v1/library/resources/${encodeURIComponent(pluginRow?.id ?? "plugin:mine")}/sync`,
      { body: { dry_run: true } },
    );
    expect(response?.status).toBe(400);
    const body = (await response?.json()) as { error: string };
    expect(body.error).toBe("sync_not_allowed");
  });

  it("body on_conflict wins over query", async () => {
    const home = await withHome("parity-mutate-body-wins");
    const before = seedLinkedSkill(home.homeDir, "# stale cache\n");
    const response = await handle(
      "POST",
      `/v1/library/resources/${encodeURIComponent(before.id)}/sync?on_conflict=fail`,
      { body: { dry_run: false, on_conflict: "overwrite" } },
    );
    expect(response?.status).toBe(200);
    expect(getResource(before.id)?.content).toContain("shared team review checklist");
  });
});
