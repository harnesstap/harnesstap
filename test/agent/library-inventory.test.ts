import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { handleLibraryInventory } from "../../src/agent/library-inventory-handlers.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";

const TOKEN = "test-token";

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

function inventoryRequest(
  query = "",
  init: { token?: string; headers?: HeadersInit } = {},
): Request {
  const headers = new Headers(init.headers ?? authHeaders(init.token ?? TOKEN));
  const suffix = query.length > 0 ? (query.startsWith("?") ? query : `?${query}`) : "";
  return new Request(`http://127.0.0.1/v1/library/inventory${suffix}`, {
    method: "GET",
    headers,
  });
}

describe("handleLibraryInventory", () => {
  it("wires GET /v1/library/inventory in routes.ts before resource prefix", () => {
    const routesSource = readFileSync(
      join(import.meta.dirname, "../../src/agent/routes.ts"),
      "utf8",
    );
    expect(routesSource).toContain('url.pathname === "/v1/library/inventory"');
    const inventoryIndex = routesSource.indexOf('"/v1/library/inventory"');
    const resourcePrefixIndex = routesSource.indexOf(
      'url.pathname.startsWith("/v1/library/resources/")',
    );
    expect(inventoryIndex).toBeGreaterThan(-1);
    expect(resourcePrefixIndex).toBeGreaterThan(inventoryIndex);
  });

  it("returns 401 without bearer", async () => {
    await withHome("lib-inv-401");
    const response = handleLibraryInventory(inventoryRequest("", { headers: {} }), TOKEN);
    expect(response.status).toBe(401);
  });

  it("returns paged inventory without filesystem_path and echoes limit and offset", async () => {
    await withHome("lib-inv-page");
    createResource({
      type: "skill",
      name: "alpha-peek",
      description: "peek",
      content: "# a",
      metadata: {},
      source: "manual",
    });

    const response = handleLibraryInventory(
      inventoryRequest("limit=40&offset=0"),
      TOKEN,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      limit: number;
      offset: number;
      total: number;
      type_counts: Record<string, number>;
      rows: Array<{ name: string }>;
    };
    expect(body.limit).toBe(40);
    expect(body.offset).toBe(0);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.rows.some((row) => row.name === "alpha-peek")).toBe(true);
    for (const row of body.rows) {
      expect(row).not.toHaveProperty("filesystem_path");
    }
  });

  it("forwards q and type query params", async () => {
    await withHome("lib-inv-query");
    createResource({
      type: "skill",
      name: "fleet-ship",
      namespace: "fleet",
      description: "deploy",
      content: "# s",
      metadata: {},
      source: "manual",
    });
    createResource({
      type: "skill",
      name: "other-skill",
      description: "nope",
      content: "# o",
      metadata: {},
      source: "manual",
    });
    createPlugin({ name: "pack" });
    createResource({
      type: "plugin",
      name: "pack-ref",
      description: "ref",
      content: "",
      metadata: {},
      source: "manual",
    });

    const searched = handleLibraryInventory(inventoryRequest("q=fleet"), TOKEN);
    expect(searched.status).toBe(200);
    const searchBody = (await searched.json()) as {
      rows: Array<{ name: string }>;
      total: number;
    };
    expect(searchBody.rows.map((row) => row.name)).toEqual(["fleet-ship"]);
    expect(searchBody.total).toBe(1);

    const pluginsOnly = handleLibraryInventory(inventoryRequest("type=plugin"), TOKEN);
    const pluginBody = (await pluginsOnly.json()) as {
      rows: Array<{ listKind: string; name: string }>;
    };
    expect(pluginBody.rows.every((row) => row.listKind === "plugin-package")).toBe(true);
    expect(pluginBody.rows.some((row) => row.name === "pack")).toBe(true);

    const refsOnly = handleLibraryInventory(inventoryRequest("type=plugin_ref"), TOKEN);
    const refBody = (await refsOnly.json()) as {
      rows: Array<{ listKind: string; type: string; name: string }>;
    };
    expect(
      refBody.rows.every((row) => row.listKind === "resource" && row.type === "plugin"),
    ).toBe(true);
    expect(refBody.rows.some((row) => row.name === "pack-ref")).toBe(true);
  });
});
