import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { tryHandle } from "../../src/agent/parity-handlers/resolve-order.ts";
import { addResourceToPlugin, createPlugin, getPluginByName } from "../../src/models/plugin-model.ts";
import { upsertProject } from "../../src/models/project.ts";
import { createResource } from "../../src/models/resource.ts";
import { createSnapshot } from "../../src/models/snapshot.ts";
import { addPluginAttachment } from "../../src/services/plugin-composition.ts";
import { getPluginOverrides } from "../../src/services/plugin-overrides.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";

const TOKEN = "test-token";
const DEPS = { isAgentSwitchInProgress: () => false };

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("parity-resolve-order-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function skill(name: string, content: string, ns: string) {
  return createResource({
    type: "skill",
    name,
    description: "",
    content,
    metadata: {},
    source: "test",
    namespace: ns,
  });
}

async function seedSnapshotMismatch(): Promise<{ rootId: string }> {
  const dep = createPlugin({ name: "dep" });
  const depSkill = skill("alpha", "FROM-DEP", "dep");
  addResourceToPlugin(dep.id, depSkill.id);

  const root = createPlugin({ name: "root" });
  const rootSkill = skill("alpha", "FROM-ROOT", "root");
  addResourceToPlugin(root.id, rootSkill.id);
  const rootPlugin = getPluginByName("root");
  if (!rootPlugin) throw new Error("missing root");
  await addPluginAttachment({ plugin: rootPlugin, selector: "plugin:dep" });

  const project = upsertProject({
    git_origin: "github.com/acme/repo",
    name: "repo",
    local_path: ctx.projectDir,
  });
  createSnapshot({
    project_id: project.id,
    label: "Before applying: root",
    state: {
      plugins: [rootPlugin],
      resources: [depSkill],
      platform_files: {},
    },
  });
  return { rootId: root.id };
}

function request(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Request {
  const headers = new Headers(init.headers);
  if (init.token !== null && init.token !== undefined) {
    headers.set("authorization", `Bearer ${init.token}`);
  } else if (init.token === undefined) {
    headers.set("authorization", `Bearer ${TOKEN}`);
  }
  return new Request(`http://127.0.0.1${path}`, { ...init, headers });
}

async function handle(
  path: string,
  init?: RequestInit & { token?: string | null },
): Promise<Response | null> {
  return tryHandle(request(path, init), TOKEN, DEPS);
}

describe("POST /v1/migrate/resolve-order", () => {
  it("returns null for other method+path combinations", async () => {
    const get = await handle("/v1/migrate/resolve-order", { method: "GET" });
    expect(get).toBeNull();
    const other = await handle("/v1/migrate/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    expect(other).toBeNull();
  });

  it("returns 401 without a valid bearer token", async () => {
    const response = await handle("/v1/migrate/resolve-order", {
      method: "POST",
      token: null,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    expect(response).not.toBeNull();
    expect(response!.status).toBe(401);
    const body = await response!.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 400 invalid_json for a non-JSON body", async () => {
    const response = await handle("/v1/migrate/resolve-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    expect(response!.status).toBe(400);
    const body = await response!.json();
    expect(body.error).toBe("invalid_json");
  });

  it("returns 400 invalid_body when the body is not an object", async () => {
    const response = await handle("/v1/migrate/resolve-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(["dryRun"]),
    });
    expect(response!.status).toBe(400);
    const body = await response!.json();
    expect(body.error).toBe("invalid_body");
  });

  it("returns 400 invalid_dry_run when dryRun is present and not a boolean", async () => {
    const response = await handle("/v1/migrate/resolve-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: "yes" }),
    });
    expect(response!.status).toBe(400);
    const body = await response!.json();
    expect(body.error).toBe("invalid_dry_run");
    expect(body.message).toBe("dryRun must be a boolean");
  });

  it("does not treat dry_run as dryRun (omitted camelCase means persist)", async () => {
    const { rootId } = await seedSnapshotMismatch();
    const response = await handle("/v1/migrate/resolve-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dry_run: true }),
    });
    expect(response!.status).toBe(200);
    expect(getPluginOverrides(rootId).resources["skill:alpha"]).toBe("dep");
  });

  it("dry-run returns the would-write row and does not persist", async () => {
    const { rootId } = await seedSnapshotMismatch();
    const response = await handle("/v1/migrate/resolve-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    expect(response!.status).toBe(200);
    const body = await response!.json();
    expect(body.projectsWithSnapshot).toBe(1);
    expect(body.overridesWritten).toContainEqual({
      root: "root",
      key: "skill:alpha",
      winner: "dep",
    });
    expect(getPluginOverrides(rootId).resources["skill:alpha"]).toBeUndefined();
  });

  it("omitted dryRun persists the override", async () => {
    const { rootId } = await seedSnapshotMismatch();
    const response = await handle("/v1/migrate/resolve-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response!.status).toBe(200);
    const body = await response!.json();
    expect(body.overridesWritten).toContainEqual({
      root: "root",
      key: "skill:alpha",
      winner: "dep",
    });
    expect(getPluginOverrides(rootId).resources["skill:alpha"]).toBe("dep");
  });

  it("dryRun false persists; a second write returns an empty overridesWritten", async () => {
    const { rootId } = await seedSnapshotMismatch();
    const first = await handle("/v1/migrate/resolve-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: false }),
    });
    expect(first!.status).toBe(200);
    expect(getPluginOverrides(rootId).resources["skill:alpha"]).toBe("dep");

    const second = await handle("/v1/migrate/resolve-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: false }),
    });
    expect(second!.status).toBe(200);
    const body = await second!.json();
    expect(body.overridesWritten).toEqual([]);
    expect(getPluginOverrides(rootId).resources["skill:alpha"]).toBe("dep");
  });
});
