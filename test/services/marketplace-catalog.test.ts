import { describe, it, expect } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { addMarketplace } from "../../src/services/marketplace-registry.js";
import {
  ensureMarketplaceCatalog,
  listCatalogPlugins,
  refreshMarketplaceCatalog,
  searchCatalogPlugins,
} from "../../src/services/marketplace-catalog.js";

function initLocalMarketplaceRepo(manifestName = "local-market"): string {
  const repo = mkdtempSync(join(tmpdir(), "ht-mkt-repo-"));
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: manifestName,
      plugins: [
        { name: "alpha", version: "1.0.0", description: "Slack helpers" },
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
    expect(searchCatalogPlugins(home, "slack").map((p) => p.name)).toEqual(["alpha"]);
  });

  it("search matches plugin.json and nested skill/command names and descriptions", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-home-"));
    const repo = mkdtempSync(join(tmpdir(), "ht-mkt-nested-"));
    mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
    mkdirSync(
      join(repo, "plugins", "code-review-workflow", ".claude-plugin"),
      { recursive: true },
    );
    mkdirSync(
      join(repo, "plugins", "code-review-workflow", "skills", "request-slack-review"),
      { recursive: true },
    );
    mkdirSync(join(repo, "plugins", "code-review-workflow", "commands"), {
      recursive: true,
    });
    mkdirSync(join(repo, "plugins", "design-doc", "skills", "confluence-slack-summary"), {
      recursive: true,
    });
    writeFileSync(
      join(repo, ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        name: "claude-plugins",
        plugins: [
          {
            name: "code-review-workflow",
            source: "./plugins/code-review-workflow",
            tags: ["code-review"],
          },
          {
            name: "design-doc",
            source: "./plugins/design-doc",
            tags: ["documentation"],
          },
          { name: "unrelated", version: "1.0.0" },
        ],
      }),
    );
    writeFileSync(
      join(repo, "plugins", "code-review-workflow", ".claude-plugin", "plugin.json"),
      JSON.stringify({
        name: "code-review-workflow",
        description: "End-to-end code review workflow.",
        keywords: ["request-slack-review"],
      }),
    );
    writeFileSync(
      join(
        repo,
        "plugins",
        "code-review-workflow",
        "skills",
        "request-slack-review",
        "SKILL.md",
      ),
      "---\nname: request-slack-review\ndescription: Request a Slack code review from the owning team.\n---\n\n# Request Slack review\n",
    );
    writeFileSync(
      join(repo, "plugins", "code-review-workflow", "commands", "open-pr.md"),
      "---\ndescription: Open a draft GitHub PR\n---\n\n# open-pr\n",
    );
    mkdirSync(join(repo, "plugins", "design-doc", ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(repo, "plugins", "design-doc", ".claude-plugin", "plugin.json"),
      JSON.stringify({
        name: "design-doc",
        description: "Scaffold architecture docs.",
      }),
    );
    writeFileSync(
      join(
        repo,
        "plugins",
        "design-doc",
        "skills",
        "confluence-slack-summary",
        "SKILL.md",
      ),
      "---\nname: confluence-slack-summary\ndescription: Summarize a design doc and create a Slack draft.\n---\n\n# Summary\n",
    );
    spawnSync("git", ["init"], { cwd: repo });
    spawnSync("git", ["add", "."], { cwd: repo });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], {
      cwd: repo,
    });
    spawnSync("git", ["branch", "-M", "main"], { cwd: repo });
    addMarketplace(home, {
      name: "claude-plugins",
      url: repo,
      platforms: ["claude-code"],
    });
    refreshMarketplaceCatalog(home, { name: "claude-plugins", force: true });

    const listed = listCatalogPlugins(home, { name: "claude-plugins" });
    const review = listed.find((plugin) => plugin.name === "code-review-workflow");
    expect(review?.description).toBe("End-to-end code review workflow.");
    expect(review?.tags).toEqual(
      expect.arrayContaining(["code-review", "request-slack-review"]),
    );
    expect(review?.contents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "skill",
          name: "request-slack-review",
        }),
        expect.objectContaining({ type: "command", name: "open-pr" }),
      ]),
    );

    expect(searchCatalogPlugins(home, "slack").map((plugin) => plugin.name).sort()).toEqual([
      "code-review-workflow",
      "design-doc",
    ]);
    expect(searchCatalogPlugins(home, "request-slack-review").map((plugin) => plugin.name)).toEqual([
      "code-review-workflow",
    ]);
    expect(searchCatalogPlugins(home, "open a draft").map((plugin) => plugin.name)).toEqual([
      "code-review-workflow",
    ]);
  });

  it("uses registry name for plugin refs when manifest name differs", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-home-"));
    const repo = initLocalMarketplaceRepo("acme-plugins");
    addMarketplace(home, {
      name: "team",
      url: repo,
      platforms: ["claude-code"],
    });
    const refreshed = refreshMarketplaceCatalog(home, { name: "team", force: true });
    expect(refreshed.ok).toBe(true);
    const plugins = listCatalogPlugins(home, { name: "team" });
    expect(plugins.map((p) => p.ref).sort()).toEqual(["alpha@team", "beta@team"]);
    const catalogPath = join(home, "cache", "marketplaces", "team", "catalog.json");
    const stored = JSON.parse(readFileSync(catalogPath, "utf8"));
    expect(stored.marketplaceName).toBe("team");
    expect(stored.manifestName).toBe("acme-plugins");
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

  it("dedups plugins that appear on extra tracked branches", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-home-"));
    const repo = initLocalMarketplaceRepo();
    writeFileSync(
      join(repo, ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        name: "local-market",
        plugins: [
          { name: "alpha", version: "2.0.0" },
          { name: "gamma", version: "1.0.0" },
        ],
      }),
    );
    spawnSync("git", ["add", "."], { cwd: repo });
    spawnSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "develop"],
      { cwd: repo },
    );
    spawnSync("git", ["branch", "develop"], { cwd: repo });
    spawnSync("git", ["reset", "--hard", "HEAD~1"], { cwd: repo });

    addMarketplace(home, {
      name: "local-market",
      url: repo,
      platforms: ["claude-code"],
      trackedBranches: ["develop"],
    });
    const refreshed = refreshMarketplaceCatalog(home, {
      name: "local-market",
      force: true,
    });
    expect(refreshed.ok).toBe(true);
    const plugins = listCatalogPlugins(home, { name: "local-market" });
    expect(plugins.map((p) => p.name).sort()).toEqual(["alpha", "beta", "gamma"]);
    expect(plugins.find((p) => p.name === "alpha")?.version).toBe("2.0.0");
    expect(plugins.filter((p) => p.name === "alpha")).toHaveLength(1);
  });

  it("reuses a fresh on-disk catalog instead of cloning the marketplace again", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-home-"));
    const repo = initLocalMarketplaceRepo();
    addMarketplace(home, {
      name: "local-market",
      url: repo,
      platforms: ["claude-code"],
    });
    expect(
      ensureMarketplaceCatalog(home, { name: "local-market" }).map((p) => p.name).sort(),
    ).toEqual(["alpha", "beta"]);

    writeFileSync(
      join(repo, ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        name: "local-market",
        plugins: [{ name: "gamma", version: "9.0.0" }],
      }),
    );
    spawnSync("git", ["add", "."], { cwd: repo });
    spawnSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "stale"],
      { cwd: repo },
    );

    expect(
      ensureMarketplaceCatalog(home, { name: "local-market" }).map((p) => p.name).sort(),
    ).toEqual(["alpha", "beta"]);
    expect(
      refreshMarketplaceCatalog(home, { name: "local-market", force: false }).message,
    ).toBe("Catalog is up to date");
  });
});
