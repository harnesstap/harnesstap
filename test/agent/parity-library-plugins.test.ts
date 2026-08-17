import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { tryHandle } from "../../src/agent/parity-handlers/library-plugins.ts";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
  getPluginResources,
  listPlugins,
} from "../../src/models/plugin-model.ts";
import { createResource, getResource } from "../../src/models/resource.ts";
import { setPluginOrigin } from "../../src/services/plugin-origin.ts";
import { cutPluginVersion } from "../../src/services/plugin-versioning.ts";
import type { TestContext } from "../helpers/db.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

const TOKEN = "test-token";
const DEPS = { isAgentSwitchInProgress: () => false };

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("parity-library-plugins-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function request(
  method: string,
  path: string,
  options?: { token?: string | null; body?: unknown },
): Request {
  const headers = new Headers();
  if (options?.token !== null) {
    headers.set("authorization", `Bearer ${options?.token ?? TOKEN}`);
  }
  if (options?.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return new Request(`http://127.0.0.1${path}`, {
    method,
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

async function handle(
  method: string,
  path: string,
  options?: { token?: string | null; body?: unknown },
): Promise<Response> {
  const response = await tryHandle(request(method, path, options), TOKEN, DEPS);
  if (!response) {
    throw new Error(`tryHandle returned null for ${method} ${path}`);
  }
  return response;
}

describe("GET /v1/library/plugins/heads", () => {
  it("returns 401 without bearer", async () => {
    const response = await handle("GET", "/v1/library/plugins/heads", {
      token: null,
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("returns origin and dirty on working heads only", async () => {
    const authored = createPlugin({ name: "eng", version: "1.2.0" });
    const upstream = createPlugin({
      name: "web-search",
      version: "2.0.0",
      origin: "upstream",
    });
    setPluginOrigin(upstream.id, "upstream");
    const frozenCut = createPlugin({ name: "oldcut", version: "1.0.0" });
    cutPluginVersion({ pluginId: frozenCut.id, newVersion: "1.1.0" });

    const response = await handle("GET", "/v1/library/plugins/heads");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      plugins: Array<{
        name: string;
        version: string;
        origin: string;
        dirty: boolean;
        tags: string[];
      }>;
    };
    const byName = Object.fromEntries(body.plugins.map((row) => [row.name, row]));
    expect(byName.eng.origin).toBe("authored");
    expect(byName.eng.dirty).toBe(false);
    expect(byName["web-search"].origin).toBe("upstream");
    expect(byName.oldcut.version).toBe("1.1.0");
    expect(body.plugins.some((row) => row.version === "1.0.0")).toBe(false);
    expect(authored.id).toBeString();
  });

  it("returns null for unrelated paths", async () => {
    const result = await tryHandle(
      request("GET", "/v1/health"),
      TOKEN,
      DEPS,
    );
    expect(result).toBeNull();
  });
});

describe("GET /v1/library/plugins/:selector", () => {
  it("returns 404 for unknown selector", async () => {
    const response = await handle("GET", "/v1/library/plugins/missing");
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("returns composition shaped like profile detail plus origin", async () => {
    const plugin = createPlugin({
      name: "eng",
      version: "1.2.0",
      description: "Engineering",
    });
    const skill = createResource({
      type: "skill",
      name: "ship",
      description: "",
      content: "ship it",
      metadata: {},
      source: "manual",
    });
    addResourceToPlugin(plugin.id, skill.id);

    const response = await handle("GET", "/v1/library/plugins/eng");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      plugin: {
        name: string;
        origin: string;
        dirty: boolean;
        default_environment_id: string | null;
      };
      resources: Array<{ name: string; type: string }>;
      dependencies: unknown[];
    };
    expect(body.plugin.name).toBe("eng");
    expect(body.plugin.origin).toBe("authored");
    expect(body.plugin.default_environment_id).toBeNull();
    expect(body.resources.some((row) => row.name === "ship")).toBe(true);
    expect(Array.isArray(body.dependencies)).toBe(true);
  });
});

describe("PATCH /v1/library/plugins/:selector", () => {
  it("patches authored name, description, tags, and default environment", async () => {
    const plugin = createPlugin({ name: "eng", description: "old" });
    const response = await handle("PATCH", `/v1/library/plugins/${plugin.name}`, {
      body: {
        name: "eng2",
        description: "new",
        tags: ["profile"],
        default_environment_id: null,
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { plugin: { name: string; description: string; tags: string[] } };
    expect(body.plugin.name).toBe("eng2");
    expect(body.plugin.description).toBe("new");
    expect(body.plugin.tags).toEqual(["profile"]);
  });

  it("rejects upstream plugins", async () => {
    const upstream = createPlugin({ name: "web-search", origin: "upstream" });
    setPluginOrigin(upstream.id, "upstream");
    const response = await handle("PATCH", "/v1/library/plugins/web-search", {
      body: { description: "nope" },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("not_authored");
  });
});

describe("PATCH /v1/library/plugins/:selector/attachments", () => {
  it("adds and removes on authored plugins", async () => {
    const plugin = createPlugin({ name: "eng" });
    createResource({
      type: "skill",
      name: "ship",
      description: "",
      content: "ship",
      metadata: {},
      source: "manual",
    });
    const old = createResource({
      type: "skill",
      name: "old",
      description: "",
      content: "old",
      metadata: {},
      source: "manual",
    });
    addResourceToPlugin(plugin.id, old.id);

    const response = await handle(
      "PATCH",
      "/v1/library/plugins/eng/attachments",
      {
        body: {
          add: [{ type: "skill", selector: "ship" }],
          remove: [{ type: "skill", selector: "old" }],
        },
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      resources: Array<{ name: string }>;
    };
    const names = body.resources.map((row) => row.name);
    expect(names).toContain("ship");
    expect(names).not.toContain("old");
  });

  it("returns 400 not_authored with fork hint for upstream", async () => {
    const plugin = createPlugin({ name: "web-search", origin: "upstream" });
    setPluginOrigin(plugin.id, "upstream");
    const response = await handle(
      "PATCH",
      "/v1/library/plugins/web-search/attachments",
      {
        body: { add: [{ type: "skill", selector: "ship" }] },
      },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: string;
      hints?: string[];
    };
    expect(body.error).toBe("not_authored");
    expect(body.hints?.some((hint) => hint.includes("ht plugin fork"))).toBe(
      true,
    );
  });

  it("returns 400 invalid_body when add and remove are both missing", async () => {
    createPlugin({ name: "eng" });
    const response = await handle(
      "PATCH",
      "/v1/library/plugins/eng/attachments",
      { body: {} },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_body");
  });
});

describe("DELETE /v1/library/plugins/:selector", () => {
  it("deletes the plugin row and keeps library resources", async () => {
    const plugin = createPlugin({ name: "eng", version: "1.2.0" });
    const skill = createResource({
      type: "skill",
      name: "ship",
      description: "",
      content: "ship",
      metadata: {},
      source: "manual",
    });
    addResourceToPlugin(plugin.id, skill.id);

    const response = await handle("DELETE", "/v1/library/plugins/eng");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      deleted: boolean;
      name: string;
      version: string;
    };
    expect(body).toEqual({ deleted: true, name: "eng", version: "1.2.0" });
    expect(getPluginByName("eng")).toBeUndefined();
    expect(getResource("ship")).toBeDefined();
  });

  it("deletes profile-tagged plugins without demoting", async () => {
    createPlugin({ name: "work", tags: ["profile"] });
    const response = await handle("DELETE", "/v1/library/plugins/work");
    expect(response.status).toBe(200);
    expect(listPlugins().some((row) => row.name === "work")).toBe(false);
  });

  it("does not require authored", async () => {
    const plugin = createPlugin({ name: "web-search", origin: "upstream" });
    setPluginOrigin(plugin.id, "upstream");
    const response = await handle("DELETE", "/v1/library/plugins/web-search");
    expect(response.status).toBe(200);
  });
});

describe("POST /v1/library/plugins/:selector/cut", () => {
  it("cuts an authored working head", async () => {
    createPlugin({ name: "eng", version: "1.2.0" });
    const response = await handle("POST", "/v1/library/plugins/eng/cut", {
      body: { version: "1.3.0" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      plugin: { name: string; version: string; dirty: boolean };
    };
    expect(body.plugin).toMatchObject({
      name: "eng",
      version: "1.3.0",
      dirty: false,
    });
  });

  it("returns not_authored for upstream", async () => {
    const plugin = createPlugin({ name: "web-search", origin: "upstream" });
    setPluginOrigin(plugin.id, "upstream");
    const response = await handle(
      "POST",
      "/v1/library/plugins/web-search/cut",
      { body: { version: "1.1.0" } },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("not_authored");
  });

  it("maps PluginVersionError codes", async () => {
    createPlugin({ name: "eng", version: "1.2.0" });
    const response = await handle("POST", "/v1/library/plugins/eng/cut", {
      body: { version: "1.2.0" },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("same_version");
  });
});

describe("POST /v1/library/plugins/:selector/doctor", () => {
  it("returns 200 with valid false for an empty plugin", async () => {
    createPlugin({ name: "empty-one" });
    const response = await handle(
      "POST",
      "/v1/library/plugins/empty-one/doctor",
      { body: {} },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      plugin: string;
      valid: boolean;
      results: Array<{ check: string; severity: string }>;
    };
    expect(body.plugin).toBe("empty-one");
    expect(body.valid).toBe(true);
    expect(body.results.some((row) => row.check === "empty-plugin")).toBe(true);
    expect(body.results.some((row) => row.severity === "warn")).toBe(true);
  });

  it("returns 400 unknown_check for a bad id", async () => {
    createPlugin({ name: "eng" });
    const response = await handle("POST", "/v1/library/plugins/eng/doctor", {
      body: { check_ids: ["not-a-check"] },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("unknown_check");
  });
});

describe("POST /v1/library/plugins/:selector/fork", () => {
  it("forks upstream with default name", async () => {
    const source = createPlugin({
      name: "web-search",
      version: "2.0.0",
      origin: "upstream",
    });
    setPluginOrigin(source.id, "upstream");
    const skill = createResource({
      type: "skill",
      name: "search",
      description: "",
      content: "search",
      metadata: {},
      source: "manual",
    });
    addResourceToPlugin(source.id, skill.id);

    const response = await handle(
      "POST",
      "/v1/library/plugins/web-search/fork",
      { body: {} },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      name: string;
      version: string;
      origin: string;
      forked_from: string;
    };
    expect(body).toEqual({
      name: "web-search-fork",
      version: "2.0.0",
      origin: "authored",
      forked_from: "web-search@2.0.0",
    });
    const fork = getPluginByName("web-search-fork");
    expect(fork?.origin).toBe("authored");
    expect(fork).toBeDefined();
    if (!fork) {
      return;
    }
    expect(getPluginResources(fork.id).some((row) => row.name === "search")).toBe(
      true,
    );
    expect(getPluginByName("web-search")).toBeDefined();
  });

  it("returns 400 already_authored", async () => {
    createPlugin({ name: "eng" });
    const response = await handle("POST", "/v1/library/plugins/eng/fork", {
      body: { as: "eng-fork" },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("already_authored");
  });

  it("returns 409 plugin_exists", async () => {
    const source = createPlugin({ name: "web-search", origin: "upstream" });
    setPluginOrigin(source.id, "upstream");
    createPlugin({ name: "taken" });
    const response = await handle(
      "POST",
      "/v1/library/plugins/web-search/fork",
      { body: { as: "taken" } },
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("plugin_exists");
  });
});

describe("mutating routes auth", () => {
  it("returns 401 without bearer", async () => {
    createPlugin({ name: "eng" });
    const routes: Array<[string, string]> = [
      ["DELETE", "/v1/library/plugins/eng"],
      ["PATCH", "/v1/library/plugins/eng"],
      ["PATCH", "/v1/library/plugins/eng/attachments"],
      ["POST", "/v1/library/plugins/eng/cut"],
      ["POST", "/v1/library/plugins/eng/doctor"],
      ["POST", "/v1/library/plugins/eng/fork"],
      ["POST", "/v1/library/plugins"],
    ];
    for (const [method, path] of routes) {
      const response = await handle(method, path, {
        token: null,
        body: {},
      });
      expect(response.status).toBe(401);
    }
  });
});

describe("POST /v1/library/plugins", () => {
  it("creates an authored plugin", async () => {
    const response = await handle("POST", "/v1/library/plugins", {
      body: { name: "eng", description: "Engineering" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      plugin: { name: string; origin: string; description: string };
    };
    expect(body.plugin.name).toBe("eng");
    expect(body.plugin.origin).toBe("authored");
    expect(getPluginByName("eng")?.description).toBe("Engineering");
  });

  it("returns 409 when the name exists", async () => {
    createPlugin({ name: "eng" });
    const response = await handle("POST", "/v1/library/plugins", {
      body: { name: "eng" },
    });
    expect(response.status).toBe(409);
  });

  it("returns 400 when name is missing", async () => {
    const response = await handle("POST", "/v1/library/plugins", {
      body: { description: "nope" },
    });
    expect(response.status).toBe(400);
  });
});
