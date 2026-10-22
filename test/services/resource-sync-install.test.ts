import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { createPlugin, getPluginByName } from "../../src/models/plugin-model.ts";
import { addMarketplace, listMarketplaces } from "../../src/services/marketplace-registry.ts";
import { registerDeclaredMarketplaces } from "../../src/services/claude-marketplace-bootstrap.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { wellKnownMarketplaceEntry } from "../../src/services/builtin-marketplaces.ts";
import { syncResourcesInstallingDependencies } from "../../src/services/resource-sync-install.ts";
import { syncPluginPinsForApply } from "../../src/services/plugin-pin-apply.ts";

// `ht resource sync plugin:<name>@<marketplace>` is the fix apply prints for
// a marketplace dependency with no local version. It must install the
// dependency, not only reread an install that does not exist yet.
function initMarketplace(): string {
  const repo = mkdtempSync(join(tmpdir(), "ht-sync-install-mkt-"));
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  mkdirSync(join(repo, "plugins", "alpha", ".claude-plugin"), { recursive: true });
  mkdirSync(join(repo, "plugins", "alpha", "skills", "alpha-skill"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "local-market",
      plugins: [{ name: "alpha", version: "1.0.0", source: "./plugins/alpha" }],
    }),
  );
  writeFileSync(
    join(repo, "plugins", "alpha", ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "alpha", version: "1.0.0", description: "Alpha plugin" }),
  );
  writeFileSync(
    join(repo, "plugins", "alpha", "skills", "alpha-skill", "SKILL.md"),
    "---\nname: alpha-skill\ndescription: Alpha skill\n---\n# alpha\n",
  );
  const git = (...args: string[]) =>
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo, stdio: "ignore" });
  git("init");
  git("add", ".");
  git("commit", "-m", "init");
  git("branch", "-M", "main");
  return repo;
}

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("sync-install-");
});
afterEach(async () => {
  await ctx.cleanup();
});

describe("resource sync of a marketplace dependency", () => {
  it("installs a dependency that was never installed, then syncs it", async () => {
    addMarketplace(join(ctx.homeDir, ".harnesstap"), {
      name: "local-market",
      url: initMarketplace(),
      platforms: ["claude-code"],
    });
    const profile = createPlugin({ name: "prof", version: "1.0.0" });
    addDependency(profile.id, "alpha@local-market", { versionConstraint: "1.0.0" });

    const result = await syncResourcesInstallingDependencies({
      selector: "plugin:alpha@local-market",
      homeRoot: ctx.homeDir,
    });
    expect(result.stale).toEqual([]);
    expect(result.checked).toBeGreaterThan(0);
    expect(getPluginByName("alpha", "1.0.0")).toBeDefined();
  });

  it("names the command that adds a marketplace it cannot resolve", async () => {
    const profile = createPlugin({ name: "prof", version: "1.0.0" });
    addDependency(profile.id, "alpha@nowhere-market", { versionConstraint: "1.0.0" });

    const result = await syncResourcesInstallingDependencies({
      selector: "plugin:alpha@nowhere-market",
      homeRoot: ctx.homeDir,
    });
    expect(result.stale).toHaveLength(1);
    expect(result.stale[0]?.reason).toContain("ht marketplace add <git-url> --name nowhere-market");
  });

  it("reports an install that fails as failed, not only stale", async () => {
    const profile = createPlugin({ name: "prof", version: "1.0.0" });
    addDependency(profile.id, "alpha@nowhere-market", { versionConstraint: "1.0.0" });
    const declared = await syncResourcesInstallingDependencies({
      selector: "plugin:alpha@nowhere-market",
      homeRoot: ctx.homeDir,
    });
    expect(declared.failed?.map((entry) => entry.ref)).toEqual(["alpha@nowhere-market"]);

    const undeclared = await syncResourcesInstallingDependencies({
      selector: "plugin:beta@nowhere-market",
      homeRoot: ctx.homeDir,
    });
    expect(undeclared.failed).toEqual([
      expect.objectContaining({
        ref: "beta@nowhere-market",
        reason: expect.stringContaining("ht marketplace add <git-url> --name nowhere-market"),
      }),
    ]);
  });

  it("says a plugin is not in a known marketplace, declared or not", async () => {
    addMarketplace(join(ctx.homeDir, ".harnesstap"), {
      name: "local-market",
      url: initMarketplace(),
      platforms: ["claude-code"],
    });
    const undeclared = await syncResourcesInstallingDependencies({
      selector: "plugin:nope@local-market",
      homeRoot: ctx.homeDir,
    });
    expect(undeclared.failed).toEqual([
      { ref: "nope@local-market", reason: "Plugin nope not found in marketplace local-market." },
    ]);

    const profile = createPlugin({ name: "prof", version: "1.0.0" });
    addDependency(profile.id, "nope@local-market");
    const declared = await syncResourcesInstallingDependencies({
      selector: "plugin:nope@local-market",
      homeRoot: ctx.homeDir,
    });
    expect(declared.failed).toEqual([
      { ref: "nope@local-market", reason: "Plugin nope not found in marketplace local-market." },
    ]);
    expect(declared.stale.map((entry) => entry.reason)).toEqual([
      "Plugin nope not found in marketplace local-market.",
    ]);

    // A plugin the marketplace lists but nothing depends on is not "not
    // found", but the sync still fails: it had nothing to install.
    const listed = await syncResourcesInstallingDependencies({
      selector: "plugin:alpha@local-market",
      homeRoot: ctx.homeDir,
    });
    expect(listed.checked).toBe(0);
    expect(listed.failed).toEqual([
      {
        ref: "alpha@local-market",
        reason:
          "no plugin depends on alpha@local-market, so there is nothing to install. Add it with ht plugin add alpha@local-market --to <plugin>, then run this command again",
      },
    ]);

    addDependency(profile.id, "alpha@local-market", { versionConstraint: "1.0.0" });
    const declaredListed = await syncResourcesInstallingDependencies({
      selector: "plugin:alpha@local-market",
      homeRoot: ctx.homeDir,
    });
    expect(declaredListed.failed ?? []).toEqual([]);
    expect(declaredListed.checked).toBeGreaterThan(0);
  });

  it("resolves the marketplaces the public persona profiles depend on", () => {
    for (const name of [
      "addy-agent-skills",
      "agentic-awesome-skills",
      "cc-dev-tools",
      "claude-code-workflows",
      "claude-orchestration",
      "ecc",
      "fullstack-dev-skills",
      "impeccable",
      "llm-council",
      "mempalace",
      "slidev-plugins",
      "thedotmack",
      "ui-ux-pro-max-skill",
    ]) {
      expect(wellKnownMarketplaceEntry(name)?.url).toStartWith("https://github.com/");
    }
  });
});

describe("marketplaces a profile declares in claude.toml", () => {
  it("resolves a dependency on a declared marketplace without the claude binary", async () => {
    const repo = initMarketplace();
    const profile = createPlugin({
      name: "prof",
      version: "1.0.0",
      claude: { marketplaces: { "local-market": { source: { source: "directory", path: repo } } } },
    });
    addDependency(profile.id, "alpha@local-market", { versionConstraint: "1.0.0" });

    const result = await syncResourcesInstallingDependencies({
      selector: "plugin:alpha@local-market",
      homeRoot: ctx.homeDir,
    });
    expect(result.stale).toEqual([]);
    expect(getPluginByName("alpha", "1.0.0")).toBeDefined();
    expect(listMarketplaces(join(ctx.homeDir, ".harnesstap")).map((entry) => entry.name)).toContain("local-market");
  });

  it("registers github and git sources and leaves registered names alone", () => {
    const harnesstapDir = join(ctx.homeDir, ".harnesstap");
    addMarketplace(harnesstapDir, {
      name: "mine",
      url: "https://github.com/me/mine.git",
      platforms: ["claude-code"],
    });

    const result = registerDeclaredMarketplaces(
      {
        marketplaces: {
          mine: { source: { source: "github", repo: "someone-else/mine" } },
          "gh-market": { source: { source: "github", repo: "acme/gh-market" } },
          "git-market": { source: { source: "git", url: "https://example.com/acme/git-market.git" } },
          gone: { source: { source: "directory", path: join(ctx.homeDir, "missing") } },
        },
      },
      harnesstapDir,
    );

    expect(result.added.sort()).toEqual(["gh-market", "git-market"]);
    expect(result.skipped.map((entry) => entry.name)).toEqual(["gone"]);
    const urls = Object.fromEntries(listMarketplaces(harnesstapDir).map((entry) => [entry.name, entry.url]));
    expect(urls.mine).toBe("https://github.com/me/mine");
    expect(urls["gh-market"]).toBe("https://github.com/acme/gh-market");
    expect(urls["git-market"]).toBe("https://example.com/acme/git-market");
  });
});

describe("syncing an MCP-only plugin that declares no version", () => {
  it("resolves it at the version it was installed as instead of calling the tree empty", async () => {
    const repo = mkdtempSync(join(tmpdir(), "ht-sync-mcp-only-"));
    const pluginDir = join(repo, "external_plugins", "browser");
    mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
    mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(repo, ".claude-plugin", "marketplace.json"),
      JSON.stringify({ name: "mcp-market", plugins: [{ name: "browser", source: "./external_plugins/browser" }] }),
    );
    writeFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "browser" }));
    writeFileSync(
      join(pluginDir, ".mcp.json"),
      // The flat layout claude-plugins-official uses, with no mcpServers key.
      JSON.stringify({ browser: { command: "npx", args: ["browser-mcp"] } }),
    );
    const git = (...args: string[]) =>
      spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo, stdio: "ignore" });
    git("init");
    git("add", ".");
    git("commit", "-m", "init");
    git("branch", "-M", "main");
    addMarketplace(join(ctx.homeDir, ".harnesstap"), { name: "mcp-market", url: repo, platforms: ["claude-code"] });

    const result = await syncPluginPinsForApply({
      pins: [{ ref: "browser@mcp-market", version_constraint: "*" }],
      homeRoot: ctx.homeDir,
      projectRoot: ctx.homeDir,
      yes: true,
    });
    expect(result.unresolvedPins).toEqual([]);
    expect(getPluginByName("browser")).toBeDefined();
  });
});
