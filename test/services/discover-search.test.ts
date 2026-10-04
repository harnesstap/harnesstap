import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { createResource } from "../../src/models/resource.ts";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import * as marketplaceCatalog from "../../src/services/marketplace-catalog.ts";
import { searchDiscover } from "../../src/services/discover-search.ts";
import { addMarketplace } from "../../src/services/marketplace-registry.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

let ctx: Awaited<ReturnType<typeof createInitializedTestContext>>;

afterEach(async () => {
  await ctx?.cleanup();
});

function writeStoredCatalog(
  harnesstapDir: string,
  marketplaceName: string,
  plugins: Array<{ name: string; ref: string; description?: string }>,
): void {
  const cacheDir = join(harnesstapDir, "cache", "marketplaces", marketplaceName);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(
    join(cacheDir, "catalog.json"),
    `${JSON.stringify({
      marketplaceName,
      marketplaceEntryName: marketplaceName,
      plugins,
      refreshedAt: "2026-01-01T00:00:00.000Z",
    }, null, 2)}\n`,
  );
}

describe("searchDiscover", () => {
  it("searches stored marketplace catalogs without git refresh and ignores local", async () => {
    ctx = await createInitializedTestContext("discover-search-local-mkt");
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
    writeStoredCatalog(harnesstapDir, "acme", [
      { name: "deploy-pack", ref: "deploy-pack@acme", description: "deploy helpers" },
      { name: "notes", ref: "notes@acme", description: "unrelated" },
    ]);

    const refreshSpy = spyOn(marketplaceCatalog, "refreshMarketplaceCatalog").mockImplementation(
      () => {
        throw new Error("refreshMarketplaceCatalog must not be called");
      },
    );

    const result = searchDiscover({
      q: "deploy",
      sourceIds: ["local", "mkt:acme"],
    });

    expect(refreshSpy).not.toHaveBeenCalled();
    refreshSpy.mockRestore();

    expect(result.groups.map((group) => group.sourceId)).toEqual(["mkt:acme"]);
    expect(result.groups[0]).toMatchObject({
      sourceId: "mkt:acme",
      sourceLabel: "acme",
    });
    expect(result.groups[0]?.plugins?.map((plugin) => plugin.name)).toEqual(["deploy-pack"]);
  });

  it("omits unchecked sources and ignores unknown ids", async () => {
    ctx = await createInitializedTestContext("discover-search-omit");
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
    writeStoredCatalog(harnesstapDir, "acme", [
      { name: "deploy-pack", ref: "deploy-pack@acme", description: "deploy helpers" },
    ]);

    const localOnly = searchDiscover({
      q: "deploy",
      sourceIds: ["local", "org:acme", "cat:public", "mystery", "mkt:missing"],
    });
    expect(localOnly.groups.map((group) => group.sourceId)).toEqual([]);

    const marketplaceOnly = searchDiscover({
      q: "deploy",
      sourceIds: ["mkt:acme"],
    });
    expect(marketplaceOnly.groups.map((group) => group.sourceId)).toEqual(["mkt:acme"]);
  });

  it("returns no groups when sources are empty", async () => {
    ctx = await createInitializedTestContext("discover-search-empty");
    expect(searchDiscover({ q: "deploy", sourceIds: [] })).toEqual({ groups: [] });
  });
});
