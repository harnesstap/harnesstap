import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { handleDiscoverSearch } from "../../src/agent/discover-search-handlers.ts";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import { createResource } from "../../src/models/resource.ts";
import { addMarketplace } from "../../src/services/marketplace-registry.ts";
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

function searchRequest(
  query = "",
  init: { token?: string; headers?: HeadersInit } = {},
): Request {
  const headers = new Headers(init.headers ?? authHeaders(init.token ?? TOKEN));
  const suffix = query.length > 0 ? (query.startsWith("?") ? query : `?${query}`) : "";
  return new Request(`http://127.0.0.1/v1/discover/search${suffix}`, {
    method: "GET",
    headers,
  });
}

describe("handleDiscoverSearch", () => {
  it("wires GET /v1/discover/search in routes.ts", () => {
    const routesSource = readFileSync(
      join(import.meta.dirname, "../../src/agent/routes.ts"),
      "utf8",
    );
    expect(routesSource).toContain('url.pathname === "/v1/discover/search"');
  });

  it("returns 401 without bearer", async () => {
    await withHome("discover-search-401");
    const response = handleDiscoverSearch(searchRequest("", { headers: {} }), TOKEN);
    expect(response.status).toBe(401);
  });

  it("returns 200 groups for q and sources", async () => {
    await withHome("discover-search-200");
    const harnesstapDir = getHarnesstapDir();
    createResource({
      type: "skill",
      name: "ship-skill",
      description: "deploy docs",
      content: "# s",
      metadata: {},
      source: "manual",
    });
    addMarketplace(harnesstapDir, {
      name: "acme",
      url: "https://example.com/acme",
      platforms: ["claude-code"],
    });
    const cacheDir = join(harnesstapDir, "cache", "marketplaces", "acme");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      join(cacheDir, "catalog.json"),
      `${JSON.stringify({
        marketplaceName: "acme",
        marketplaceEntryName: "acme",
        plugins: [
          { name: "deploy-pack", ref: "deploy-pack@acme", description: "deploy helpers" },
        ],
        refreshedAt: "2026-01-01T00:00:00.000Z",
      }, null, 2)}\n`,
    );

    const response = handleDiscoverSearch(
      searchRequest("q=deploy&sources=local,mkt:acme"),
      TOKEN,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      groups: Array<{ sourceId: string; sourceLabel: string }>;
    };
    expect(body.groups.map((group) => group.sourceId)).toEqual(["local", "mkt:acme"]);
  });

  it("returns empty groups when sources are empty", async () => {
    await withHome("discover-search-empty-sources");
    const response = handleDiscoverSearch(searchRequest("q=deploy&sources="), TOKEN);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { groups: unknown[] };
    expect(body.groups).toEqual([]);
  });
});
