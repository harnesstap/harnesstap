import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const repoRoot = join(import.meta.dirname, "../..");
const inventoryClientPath = join(
  repoRoot,
  "apps/desktop/src/lib/api/library-inventory.ts",
);
const discoverClientPath = join(
  repoRoot,
  "apps/desktop/src/lib/api/discover-search.ts",
);
const agentClientPath = join(repoRoot, "apps/desktop/src/lib/agent-client.ts");

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("library inventory desktop API client", () => {
  it("exports LIBRARY_INVENTORY_PEEK_LIMIT as 40", async () => {
    const mod = await import("../../apps/desktop/src/lib/api/library-inventory.ts");
    expect(mod.LIBRARY_INVENTORY_PEEK_LIMIT).toBe(40);
  });

  it("calls GET /v1/library/inventory through agentFetch", () => {
    const source = readFileSync(inventoryClientPath, "utf8");
    expect(source).toContain('"/v1/library/inventory"');
    expect(source).toContain("agentFetch");
    expect(source).toContain("throwAgentError");
    expect(source).not.toContain("agent-client");
  });

  it("does not live in agent-client.ts", () => {
    const source = readFileSync(agentClientPath, "utf8");
    expect(source).not.toContain("/v1/library/inventory");
    expect(source).not.toContain("fetchLibraryInventory");
    expect(source).not.toContain("LIBRARY_INVENTORY_PEEK_LIMIT");
  });

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps inventory rows to LibraryListEntry with originOutdated false", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        "http://127.0.0.1:7474/v1/library/inventory?limit=40&offset=0&q=ship&type=skill",
      );
      expect(init?.signal).toBeDefined();
      return jsonResponse(200, {
        limit: 40,
        offset: 0,
        total: 1,
        type_counts: { skill: 1 },
        rows: [
          {
            listKind: "resource",
            id: "id-1",
            name: "ship-skill",
            type: "skill",
            namespace: null,
            description: "deploy",
          },
        ],
      });
    }) as unknown as typeof fetch;

    const { fetchLibraryInventory } = await import(
      "../../apps/desktop/src/lib/api/library-inventory.ts"
    );
    const controller = new AbortController();
    const result = await fetchLibraryInventory("http://127.0.0.1:7474", "tok", {
      limit: 40,
      offset: 0,
      q: "ship",
      type: "skill",
      signal: controller.signal,
    });
    expect(result.total).toBe(1);
    expect(result.type_counts).toEqual({ skill: 1 });
    expect(result.rows).toEqual([
      {
        listKind: "resource",
        id: "id-1",
        name: "ship-skill",
        type: "skill",
        namespace: null,
        description: "deploy",
        originOutdated: false,
      },
    ]);
  });
});

describe("discover search desktop API client", () => {
  it("calls GET /v1/discover/search with comma-separated sources", () => {
    const source = readFileSync(discoverClientPath, "utf8");
    expect(source).toContain('"/v1/discover/search"');
    expect(source).toContain("sources");
    expect(source).toContain("agentFetch");
    expect(source).toContain("throwAgentError");
  });

  it("does not live in agent-client.ts", () => {
    const source = readFileSync(agentClientPath, "utf8");
    expect(source).not.toContain("/v1/discover/search");
    expect(source).not.toContain("fetchDiscoverSearch");
  });

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns searchDiscover groups JSON", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "http://127.0.0.1:7474/v1/discover/search?q=deploy&sources=local%2Cmkt%3Aacme",
      );
      return jsonResponse(200, {
        groups: [
          {
            sourceId: "local",
            sourceLabel: "Library",
            resources: [{ id: "r1", name: "ship-skill", type: "skill", description: null, namespace: null }],
          },
          {
            sourceId: "mkt:acme",
            sourceLabel: "acme",
            plugins: [{ name: "deploy-pack", ref: "deploy-pack@acme" }],
          },
        ],
      });
    }) as unknown as typeof fetch;

    const { fetchDiscoverSearch } = await import(
      "../../apps/desktop/src/lib/api/discover-search.ts"
    );
    const result = await fetchDiscoverSearch("http://127.0.0.1:7474", "tok", {
      q: "deploy",
      sources: ["local", "mkt:acme"],
    });
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]?.sourceId).toBe("local");
    expect(result.groups[1]?.plugins?.[0]?.ref).toBe("deploy-pack@acme");
  });
});
