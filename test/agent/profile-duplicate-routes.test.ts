import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb } from "../../src/db/connection.ts";
import { tryHandle } from "../../src/agent/parity-handlers/library-plugins.ts";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
  getPluginResources,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { listPluginExcludes } from "../../src/services/plugin-extends.ts";
import { getProfileDetail } from "../../src/services/profile-edit.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

const TOKEN = "test-token";
const DEPS = { isAgentSwitchInProgress: () => false };

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("profile-duplicate-routes-");
});

afterEach(async () => {
  await ctx.cleanup();
});

async function handle(method: string, path: string, body?: unknown, token: string | null = TOKEN): Promise<Response> {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await tryHandle(
    new Request(`http://127.0.0.1${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    TOKEN,
    DEPS,
  );
  if (!response) throw new Error(`tryHandle returned null for ${method} ${path}`);
  return response;
}

function skill(pluginId: string, name: string): void {
  addResourceToPlugin(
    pluginId,
    createResource({ type: "skill", name, description: `${name} skill`, content: name, metadata: {}, source: "test" }).id,
  );
}

function seedParent(): void {
  const parent = createPlugin({ name: "backend", version: "1.0.0", tags: ["profile"] });
  skill(parent.id, "review");
  skill(parent.id, "deploy");
}

describe("POST /v1/library/plugins/:selector/duplicate", () => {
  it("keeps in sync by default and returns the link", async () => {
    seedParent();
    const response = await handle("POST", "/v1/library/plugins/backend/duplicate", { name: "mine" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      name: "mine",
      mode: "inherit",
      upstream: { kind: "extends", ref: "backend@^1.0.0", version_at_link: "1.0.0" },
    });
    const child = getPluginByName("mine");
    expect(child?.tags).toContain("profile");
    expect(getPluginResources(child?.id ?? "")).toEqual([]);
  });

  it("makes a separate copy with mode copy", async () => {
    seedParent();
    const response = await handle("POST", "/v1/library/plugins/backend/duplicate", { mode: "copy" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string; mode: string; upstream: { kind: string } };
    expect(body.name).toBe("backend-copy");
    expect(body.mode).toBe("copy");
    expect(body.upstream.kind).toBe("fork");
    expect(getPluginResources(getPluginByName("backend-copy")?.id ?? "").map((row) => row.name).sort()).toEqual([
      "deploy",
      "review",
    ]);
  });

  it("rejects an unknown mode and a missing token", async () => {
    seedParent();
    expect((await handle("POST", "/v1/library/plugins/backend/duplicate", { mode: "mirror" })).status).toBe(400);
    expect((await handle("POST", "/v1/library/plugins/backend/duplicate", {}, null)).status).toBe(401);
  });

  it("returns 409 when the name is taken", async () => {
    seedParent();
    createPlugin({ name: "taken" });
    const response = await handle("POST", "/v1/library/plugins/backend/duplicate", { name: "taken" });
    expect(response.status).toBe(409);
  });

  it("keeps /fork working as before", async () => {
    const source = createPlugin({ name: "web-search", version: "2.0.0", origin: "upstream" });
    skill(source.id, "search");
    const response = await handle("POST", "/v1/library/plugins/web-search/fork", {});
    expect(response.status).toBe(200);
  });
});

describe("PUT /v1/library/plugins/:selector/excludes and the profile detail", () => {
  it("hides and shows a parent item, and the detail tags inherited rows", async () => {
    seedParent();
    await handle("POST", "/v1/library/plugins/backend/duplicate", { name: "mine" });
    const child = getPluginByName("mine");
    if (!child) throw new Error("child missing");
    skill(child.id, "own-skill");

    const hide = await handle("PUT", "/v1/library/plugins/mine/excludes", { entries: ["skill:deploy"] });
    expect(hide.status).toBe(200);
    expect(await hide.json()).toEqual({ excludes: ["skill:deploy"] });

    const detail = getProfileDetail("mine");
    expect(detail.upstream?.kind).toBe("extends");
    expect(detail.excludes).toEqual(["skill:deploy"]);
    expect(detail.resources.map((row) => row.name)).toEqual(["own-skill"]);
    expect(
      (detail.inherited ?? []).map((row) => [row.name, row.source, row.hidden]).sort(),
    ).toEqual([
      ["deploy", "parent", true],
      ["review", "parent", false],
    ]);

    const show = await handle("PUT", "/v1/library/plugins/mine/excludes", { entries: [] });
    expect(await show.json()).toEqual({ excludes: [] });
    expect(listPluginExcludes(child.id)).toEqual([]);
  });

  it("rejects a bad entry and a plugin that does not keep in sync", async () => {
    seedParent();
    await handle("POST", "/v1/library/plugins/backend/duplicate", { name: "mine" });
    const bad = await handle("PUT", "/v1/library/plugins/mine/excludes", { entries: ["nonsense"] });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_exclude");
    const plain = await handle("PUT", "/v1/library/plugins/backend/excludes", { entries: ["skill:review"] });
    expect(plain.status).toBe(400);
    expect(((await plain.json()) as { error: string }).error).toBe("not_extends");
    expect((await handle("PUT", "/v1/library/plugins/nope/excludes", { entries: [] })).status).toBe(404);
  });

  it("reports a missing parent on the detail instead of failing", async () => {
    seedParent();
    await handle("POST", "/v1/library/plugins/backend/duplicate", { name: "mine" });
    // No installed version of the parent satisfies ^1.0.0 any more.
    getDb().prepare("UPDATE plugins SET version = '2.0.0' WHERE name = 'backend'").run();
    const detail = getProfileDetail("mine");
    expect(detail.inherited).toEqual([]);
    expect(detail.parent_missing).toContain("is not installed");
  });

  it("library detail carries excludes and inherited for an extends child", async () => {
    seedParent();
    await handle("POST", "/v1/library/plugins/backend/duplicate", { name: "mine" });
    const response = await handle("GET", "/v1/library/plugins/mine");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { excludes?: string[]; inherited?: unknown[]; plugin: { upstream?: unknown } };
    expect(body.excludes).toEqual([]);
    expect(body.inherited).toHaveLength(2);
    expect(body.plugin.upstream).toMatchObject({ kind: "extends" });
  });
});

describe("POST /v1/library/plugins/:selector/detach", () => {
  it("copies the parent items in and deletes nothing", async () => {
    seedParent();
    await handle("POST", "/v1/library/plugins/backend/duplicate", { name: "mine" });
    await handle("PUT", "/v1/library/plugins/mine/excludes", { entries: ["skill:deploy"] });
    const response = await handle("POST", "/v1/library/plugins/mine/detach");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { materialized: number; hidden_cleared: string[]; upstream: { kind: string } };
    expect(body.materialized).toBe(1);
    expect(body.hidden_cleared).toEqual(["skill:deploy"]);
    expect(body.upstream.kind).toBe("fork");
    expect(getPluginResources(getPluginByName("mine")?.id ?? "").map((row) => row.name)).toEqual(["review"]);
    expect(getPluginResources(getPluginByName("backend")?.id ?? "").map((row) => row.name).sort()).toEqual([
      "deploy",
      "review",
    ]);
  });
});
