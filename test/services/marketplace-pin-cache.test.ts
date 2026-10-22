import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

/**
 * A plugin repo whose plugin.json declares `version`, optionally tagged, and a
 * marketplace that lists it by URL with no version (optionally pinning the
 * commit with `sha`, as claude-plugins-official does for chrome-devtools-mcp).
 */
function initUnversionedEntryMarketplace(input: {
  name: string;
  version: string;
  tag?: string;
  pinSha?: boolean;
}): { marketplace: string } {
  const pluginRepo = mkdtempSync(join(tmpdir(), "ht-pin-unversioned-plugin-"));
  mkdirSync(join(pluginRepo, ".claude-plugin"), { recursive: true });
  mkdirSync(join(pluginRepo, "skills", "gamma-skill"), { recursive: true });
  writeFileSync(
    join(pluginRepo, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "gamma", version: input.version }),
  );
  writeFileSync(
    join(pluginRepo, "skills", "gamma-skill", "SKILL.md"),
    "---\nname: gamma-skill\ndescription: Gamma skill\n---\n# gamma\n",
  );
  spawnSync("git", ["init"], { cwd: pluginRepo, stdio: "ignore" });
  commitAll(pluginRepo, "release");
  if (input.tag) spawnSync("git", ["tag", input.tag], { cwd: pluginRepo, stdio: "ignore" });
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: pluginRepo, encoding: "utf8" }).stdout.trim();

  const marketplace = mkdtempSync(join(tmpdir(), "ht-pin-unversioned-mkt-"));
  mkdirSync(join(marketplace, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(marketplace, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: input.name,
      plugins: [
        {
          name: "gamma",
          source: {
            source: "url",
            url: `file://${pluginRepo}`,
            ...(input.pinSha ? { sha } : {}),
          },
        },
      ],
    }),
  );
  spawnSync("git", ["init"], { cwd: marketplace, stdio: "ignore" });
  commitAll(marketplace, "init");
  spawnSync("git", ["branch", "-M", "main"], { cwd: marketplace, stdio: "ignore" });
  return { marketplace };
}

describe("installMarketplacePinIntoCache for an entry that advertises no version", () => {
  const cases = [
    { title: "a commit-pinned entry tagged <name>-v<version>", tag: "gamma-v1.11.0", pinSha: true },
    { title: "a commit-pinned entry with no tags", pinSha: true },
    { title: "an untagged repository whose plugin.json declares the version" },
  ];
  for (const testCase of cases) {
    it(`resolves ${testCase.title}`, async () => {
      const context = await createTestContext("pin-cache-unversioned");
      try {
        context.schema.initializeSchema(context.connection.getDb());
        const harnesstapDir = join(context.homeDir, ".harnesstap");
        const { marketplace } = initUnversionedEntryMarketplace({
          name: "sha-market",
          version: "1.11.0",
          ...(testCase.tag ? { tag: testCase.tag } : {}),
          ...(testCase.pinSha ? { pinSha: true } : {}),
        });
        addMarketplace(harnesstapDir, { name: "sha-market", url: marketplace, platforms: ["claude-code"] });

        const result = await installMarketplacePinIntoCache({
          originRef: "gamma@sha-market",
          versionConstraint: "1.11.0",
          homeRoot: context.homeDir,
          harnesstapDir,
        });
        expect(result.version).toBe("1.11.0");
        expect(
          existsSync(
            join(hostPluginPackageDir(harnesstapDir, "sha-market", "gamma", "1.11.0"), "skills", "gamma-skill", "SKILL.md"),
          ),
        ).toBe(true);
      } finally {
        await context.cleanup();
      }
    });
  }

  it("refuses content that declares another version and says which", async () => {
    const context = await createTestContext("pin-cache-unversioned-mismatch");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const harnesstapDir = join(context.homeDir, ".harnesstap");
      const { marketplace } = initUnversionedEntryMarketplace({ name: "sha-market", version: "1.11.0", pinSha: true });
      addMarketplace(harnesstapDir, { name: "sha-market", url: marketplace, platforms: ["claude-code"] });

      await expect(
        installMarketplacePinIntoCache({
          originRef: "gamma@sha-market",
          versionConstraint: "2.0.0",
          homeRoot: context.homeDir,
          harnesstapDir,
        }),
      ).rejects.toThrow(/declares 1\.11\.0/);
      expect(existsSync(hostPluginPackageDir(harnesstapDir, "sha-market", "gamma", "2.0.0"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });
});

/**
 * A marketplace whose in-repo plugin declared 1.0.0 and then moved on to
 * `headManifest` (another version, or none, as claude-plugins-official did
 * for playwright).
 */
function initMovedOnMarketplace(headManifest: Record<string, unknown>): string {
  const repo = mkdtempSync(join(tmpdir(), "ht-pin-moved-mkt-"));
  const pluginDir = join(repo, "external_plugins", "delta");
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
  mkdirSync(join(pluginDir, "skills", "delta-skill"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "moved-market", plugins: [{ name: "delta", source: "./external_plugins/delta" }] }),
  );
  const writeRelease = (manifest: Record<string, unknown>, body: string) => {
    writeFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), JSON.stringify(manifest));
    writeFileSync(
      join(pluginDir, "skills", "delta-skill", "SKILL.md"),
      `---\nname: delta-skill\ndescription: Delta skill\n---\n# ${body}\n`,
    );
  };
  spawnSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  writeRelease({ name: "delta", version: "1.0.0" }, "one");
  commitAll(repo, "delta 1.0.0");
  writeRelease(headManifest, "head");
  commitAll(repo, "move on");
  spawnSync("git", ["branch", "-M", "main"], { cwd: repo, stdio: "ignore" });
  return repo;
}

async function withMovedOnMarketplace(
  label: string,
  headManifest: Record<string, unknown>,
  run: (homeRoot: string, harnesstapDir: string) => Promise<void>,
): Promise<void> {
  const context = await createTestContext(label);
  try {
    context.schema.initializeSchema(context.connection.getDb());
    const harnesstapDir = join(context.homeDir, ".harnesstap");
    addMarketplace(harnesstapDir, {
      name: "moved-market",
      url: initMovedOnMarketplace(headManifest),
      platforms: ["claude-code"],
    });
    await run(context.homeDir, harnesstapDir);
  } finally {
    await context.cleanup();
  }
}

function cachedSkill(harnesstapDir: string, version: string): string {
  const cached = hostPluginPackageDir(harnesstapDir, "moved-market", "delta", version);
  return readFileSync(join(cached, "skills", "delta-skill", "SKILL.md"), "utf8");
}

describe("installMarketplacePinIntoCache when the marketplace has moved past the pin", () => {
  it("installs the commit that declared the pinned version, not the head", async () => {
    await withMovedOnMarketplace("pin-cache-moved", { name: "delta", version: "2.0.0" }, async (homeRoot, harnesstapDir) => {
      const result = await installMarketplacePinIntoCache({
        originRef: "delta@moved-market",
        versionConstraint: "1.0.0",
        homeRoot,
        harnesstapDir,
      });
      expect(result.version).toBe("1.0.0");
      expect(cachedSkill(harnesstapDir, "1.0.0")).toContain("# one");
    });
  });

  it("reports the marketplace version when no commit declared the pin", async () => {
    await withMovedOnMarketplace("pin-cache-moved-missing", { name: "delta", version: "2.0.0" }, async (homeRoot, harnesstapDir) => {
      await expect(
        installMarketplacePinIntoCache({
          originRef: "delta@moved-market",
          versionConstraint: "3.0.0",
          homeRoot,
          harnesstapDir,
        }),
      ).rejects.toThrow(/is 2\.0\.0 in the marketplace.*Pin 2\.0\.0/);
      expect(existsSync(hostPluginPackageDir(harnesstapDir, "moved-market", "delta", "3.0.0"))).toBe(false);
    });
  });

  it("keeps using the marketplace copy of a plugin that no longer declares a version", async () => {
    await withMovedOnMarketplace("pin-cache-unversioned", { name: "delta" }, async (homeRoot, harnesstapDir) => {
      const result = await installMarketplacePinIntoCache({
        originRef: "delta@moved-market",
        versionConstraint: "1.0.0",
        homeRoot,
        harnesstapDir,
      });
      expect(result.version).toBe("1.0.0");
      expect(cachedSkill(harnesstapDir, "1.0.0")).toContain("# head");
    });
  });
});
