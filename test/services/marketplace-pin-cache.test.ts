import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { addMarketplace } from "../../src/services/marketplace-registry.ts";
import { refreshMarketplaceCatalog } from "../../src/services/marketplace-catalog.ts";
import { installMarketplacePinIntoCache } from "../../src/services/marketplace-pin-cache.ts";
import { hostPluginPackageDir } from "../../src/services/package-cache/paths.ts";

function initPluginMarketplace(): string {
  const repo = mkdtempSync(join(tmpdir(), "ht-pin-mkt-"));
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  mkdirSync(join(repo, "plugins", "alpha", ".claude-plugin"), { recursive: true });
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
  writeFileSync(join(repo, "plugins", "alpha", "plugin.json"), JSON.stringify({
    name: "alpha",
    version: "1.0.0",
  }));
  spawnSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  spawnSync("git", ["add", "."], { cwd: repo, stdio: "ignore" });
  spawnSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"],
    { cwd: repo, stdio: "ignore" },
  );
  spawnSync("git", ["branch", "-M", "main"], { cwd: repo, stdio: "ignore" });
  return repo;
}

describe("installMarketplacePinIntoCache", () => {
  it("copies a local marketplace plugin into the package cache", async () => {
    const context = await createTestContext("pin-cache-install");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const harnesstapDir = join(context.homeDir, ".harnesstap");
      const repo = initPluginMarketplace();
      addMarketplace(harnesstapDir, {
        name: "local-market",
        url: repo,
        platforms: ["claude-code"],
      });
      const refresh = await refreshMarketplaceCatalog(harnesstapDir, {
        name: "local-market",
        force: true,
      });
      expect(refresh.ok).toBe(true);

      const result = await installMarketplacePinIntoCache({
        originRef: "alpha@local-market",
        versionConstraint: "latest",
        homeRoot: context.homeDir,
        harnesstapDir,
      });
      expect(result.version).toBe("1.0.0");
      expect(existsSync(join(result.install_path, "plugin.json"))).toBe(true);
      expect(
        existsSync(hostPluginPackageDir(harnesstapDir, "local-market", "alpha", "1.0.0")),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});

describe("installMarketplacePinIntoCache without a marketplace.json version (O2)", () => {
  it("takes the version from the plugin's own manifest instead of 0.0.0", async () => {
    const context = await createTestContext("pin-cache-manifest-version");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const harnesstapDir = join(context.homeDir, ".harnesstap");
      const repo = initPluginMarketplace();
      writeFileSync(
        join(repo, ".claude-plugin", "marketplace.json"),
        JSON.stringify({
          name: "local-market",
          plugins: [{ name: "alpha", source: "./plugins/alpha" }],
        }),
      );
      spawnSync("git", ["add", "."], { cwd: repo, stdio: "ignore" });
      spawnSync(
        "git",
        ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "no version"],
        { cwd: repo, stdio: "ignore" },
      );
      addMarketplace(harnesstapDir, { name: "local-market", url: repo, platforms: ["claude-code"] });

      const result = await installMarketplacePinIntoCache({
        originRef: "alpha@local-market",
        versionConstraint: "",
        homeRoot: context.homeDir,
        harnesstapDir,
      });
      expect(result.version).toBe("1.0.0");
      expect(
        existsSync(hostPluginPackageDir(harnesstapDir, "local-market", "alpha", "1.0.0")),
      ).toBe(true);
      expect(
        existsSync(hostPluginPackageDir(harnesstapDir, "local-market", "alpha", "0.0.0")),
      ).toBe(false);
    } finally {
      await context.cleanup();
    }
  });
});

function commitAll(repo: string, message: string): void {
  spawnSync("git", ["add", "."], { cwd: repo, stdio: "ignore" });
  spawnSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", message],
    { cwd: repo, stdio: "ignore" },
  );
}

/** A plugin repo tagged v2.0.0, plus a marketplace that points at it by URL. */
function initUrlSourceMarketplace(name: string): { marketplace: string; pluginRepo: string } {
  const pluginRepo = mkdtempSync(join(tmpdir(), "ht-pin-url-plugin-"));
  mkdirSync(join(pluginRepo, ".claude-plugin"), { recursive: true });
  mkdirSync(join(pluginRepo, "skills", "beta-skill"), { recursive: true });
  writeFileSync(
    join(pluginRepo, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "beta", version: "2.0.0" }),
  );
  writeFileSync(
    join(pluginRepo, "skills", "beta-skill", "SKILL.md"),
    "---\nname: beta-skill\ndescription: Beta skill\n---\n# beta\n",
  );
  spawnSync("git", ["init"], { cwd: pluginRepo, stdio: "ignore" });
  commitAll(pluginRepo, "v2");
  spawnSync("git", ["tag", "v2.0.0"], { cwd: pluginRepo, stdio: "ignore" });

  const marketplace = mkdtempSync(join(tmpdir(), "ht-pin-url-mkt-"));
  mkdirSync(join(marketplace, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(marketplace, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name,
      plugins: [
        {
          name: "beta",
          source: { source: "url", url: `file://${pluginRepo}` },
        },
      ],
    }),
  );
  spawnSync("git", ["init"], { cwd: marketplace, stdio: "ignore" });
  commitAll(marketplace, "init");
  spawnSync("git", ["branch", "-M", "main"], { cwd: marketplace, stdio: "ignore" });
  return { marketplace, pluginRepo };
}

describe("installMarketplacePinIntoCache with a fresh home", () => {
  it("clones a url-sourced plugin listed by a HarnessTap-only marketplace checkout", async () => {
    const context = await createTestContext("pin-cache-url-source");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const harnesstapDir = join(context.homeDir, ".harnesstap");
      const { marketplace } = initUrlSourceMarketplace("url-market");
      // Registered with HarnessTap only: the host has no plugins directory.
      addMarketplace(harnesstapDir, {
        name: "url-market",
        url: marketplace,
        platforms: ["claude-code"],
      });

      const result = await installMarketplacePinIntoCache({
        originRef: "beta@url-market",
        versionConstraint: "2.0.0",
        homeRoot: context.homeDir,
        harnesstapDir,
      });
      expect(result.version).toBe("2.0.0");
      expect(
        existsSync(
          join(
            hostPluginPackageDir(harnesstapDir, "url-market", "beta", "2.0.0"),
            "skills",
            "beta-skill",
            "SKILL.md",
          ),
        ),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("resolves a well-known marketplace name that was never registered", async () => {
    const context = await createTestContext("pin-cache-well-known");
    const previousGlobal = process.env.GIT_CONFIG_GLOBAL;
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const harnesstapDir = join(context.homeDir, ".harnesstap");
      const repo = initPluginMarketplace();
      // Point the public URL at a local checkout so the test stays offline.
      const gitConfig = join(context.homeDir, "gitconfig");
      writeFileSync(
        gitConfig,
        `[url "${repo}"]\n\tinsteadOf = https://github.com/forrestchang/andrej-karpathy-skills.git\n`,
      );
      process.env.GIT_CONFIG_GLOBAL = gitConfig;

      const refresh = await refreshMarketplaceCatalog(harnesstapDir, {
        name: "karpathy-skills",
        force: true,
      });
      expect(refresh.ok).toBe(true);
      const result = await installMarketplacePinIntoCache({
        originRef: "alpha@karpathy-skills",
        versionConstraint: "1.0.0",
        homeRoot: context.homeDir,
        harnesstapDir,
      });
      expect(result.version).toBe("1.0.0");
      expect(
        existsSync(hostPluginPackageDir(harnesstapDir, "karpathy-skills", "alpha", "1.0.0")),
      ).toBe(true);
    } finally {
      if (previousGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previousGlobal;
      await context.cleanup();
    }
  });
});
