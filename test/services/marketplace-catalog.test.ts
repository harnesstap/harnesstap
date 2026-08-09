import { describe, it, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { addMarketplace } from "../../src/services/marketplace-registry.js";
import {
  listCatalogPlugins,
  refreshMarketplaceCatalog,
  searchCatalogPlugins,
} from "../../src/services/marketplace-catalog.js";

function initLocalMarketplaceRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "ht-mkt-repo-"));
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "local-market",
      plugins: [
        { name: "alpha", version: "1.0.0" },
        { name: "beta", version: "2.0.0" },
      ],
    }),
  );
  spawnSync("git", ["init"], { cwd: repo });
  spawnSync("git", ["add", "."], { cwd: repo });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], {
    cwd: repo,
  });
  spawnSync("git", ["branch", "-M", "main"], { cwd: repo });
  return repo;
}

describe("marketplace-catalog", () => {
  it("refreshes from git URL and lists plugins", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-home-"));
    const repo = initLocalMarketplaceRepo();
    addMarketplace(home, {
      name: "local-market",
      url: repo,
      platforms: ["claude-code"],
    });
    const refreshed = refreshMarketplaceCatalog(home, {
      name: "local-market",
      force: true,
    });
    expect(refreshed.ok).toBe(true);
    const plugins = listCatalogPlugins(home, { name: "local-market" });
    expect(plugins.map((p) => p.name).sort()).toEqual(["alpha", "beta"]);
  });

  it("search filters by query substring", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-home-"));
    const repo = initLocalMarketplaceRepo();
    addMarketplace(home, {
      name: "local-market",
      url: repo,
      platforms: ["claude-code"],
    });
    refreshMarketplaceCatalog(home, { name: "local-market", force: true });
    expect(searchCatalogPlugins(home, "alp").map((p) => p.name)).toEqual(["alpha"]);
  });

  it("rejects goose-only marketplace refresh", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-home-"));
    addMarketplace(home, {
      name: "goose-market",
      url: "/tmp/dummy-goose-marketplace",
      platforms: ["goose"],
    });
    const refreshed = refreshMarketplaceCatalog(home, {
      name: "goose-market",
      force: true,
    });
    expect(refreshed.ok).toBe(false);
    expect(refreshed.message.toLowerCase()).toContain("goose");
  });
});
