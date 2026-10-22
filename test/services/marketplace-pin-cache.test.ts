import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { addMarketplace } from "../../src/services/marketplace-registry.ts";
import {
  marketplaceCatalogPath,
  refreshMarketplaceCatalog,
} from "../../src/services/marketplace-catalog.ts";
import {
  exactPinnedVersion,
  installMarketplacePinIntoCache,
} from "../../src/services/marketplace-pin-cache.ts";
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

/** A `git` on PATH that logs network calls and sleeps instead of reaching the remote. */
function withSlowGit(sleepSeconds: number): { log: string; restore: () => void } {
  const bin = mkdtempSync(join(tmpdir(), "ht-slow-git-"));
  const log = join(bin, "calls.log");
  writeFileSync(log, "");
  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\ncase " $* " in *" clone "*|*" fetch "*|*" ls-remote "*) echo "$*" >> "${log}"; exec sleep ${sleepSeconds};; esac\nexec "${realGit}" "$@"\n`,
  );
  chmodSync(join(bin, "git"), 0o755);
  const previous = process.env.PATH;
  process.env.PATH = `${bin}:${previous ?? ""}`;
  return {
    log,
    restore: () => {
      process.env.PATH = previous;
    },
  };
}

function makeCatalogStale(harnesstapDir: string, name: string): void {
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  utimesSync(marketplaceCatalogPath(harnesstapDir, name), old, old);
}

describe("installMarketplacePinIntoCache with a slow marketplace remote (O3)", () => {
  it("knows which constraints name one exact version", () => {
    expect(exactPinnedVersion("1.0.0")).toBe("1.0.0");
    expect(exactPinnedVersion(" 2.1.3 ")).toBe("2.1.3");
    expect(exactPinnedVersion("^1.0.0")).toBeNull();
    expect(exactPinnedVersion("latest")).toBeNull();
    expect(exactPinnedVersion("*")).toBeNull();
    expect(exactPinnedVersion("")).toBeNull();
    expect(exactPinnedVersion(undefined)).toBeNull();
  });

  it("does not touch the remote for an exact version already in the package cache", async () => {
    if (process.platform === "win32") return;
    const context = await createTestContext("pin-cache-cached-exact");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const harnesstapDir = join(context.homeDir, ".harnesstap");
      const repo = initPluginMarketplace();
      addMarketplace(harnesstapDir, { name: "local-market", url: repo, platforms: ["claude-code"] });
      await installMarketplacePinIntoCache({
        originRef: "alpha@local-market",
        versionConstraint: "1.0.0",
        homeRoot: context.homeDir,
        harnesstapDir,
      });
      makeCatalogStale(harnesstapDir, "local-market");

      const git = withSlowGit(30);
      try {
        const started = Date.now();
        const result = await installMarketplacePinIntoCache({
          originRef: "alpha@local-market",
          versionConstraint: "1.0.0",
          homeRoot: context.homeDir,
          harnesstapDir,
        });
        expect(Date.now() - started).toBeLessThan(5_000);
        expect(result.version).toBe("1.0.0");
        expect(existsSync(join(result.install_path, "plugin.json"))).toBe(true);
        expect(readFileSync(git.log, "utf8")).toBe("");
      } finally {
        git.restore();
      }
    } finally {
      await context.cleanup();
    }
  });

  it("answers from the stored catalog and refreshes a stale one in the background", async () => {
    if (process.platform === "win32") return;
    const context = await createTestContext("pin-cache-stale-latest");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const harnesstapDir = join(context.homeDir, ".harnesstap");
      const repo = initPluginMarketplace();
      addMarketplace(harnesstapDir, { name: "local-market", url: repo, platforms: ["claude-code"] });
      const refresh = await refreshMarketplaceCatalog(harnesstapDir, {
        name: "local-market",
        force: true,
      });
      expect(refresh.ok).toBe(true);
      makeCatalogStale(harnesstapDir, "local-market");

      const git = withSlowGit(3);
      try {
        const started = Date.now();
        const result = await installMarketplacePinIntoCache({
          originRef: "alpha@local-market",
          versionConstraint: "latest",
          homeRoot: context.homeDir,
          harnesstapDir,
        });
        // A foreground refresh would wait for the 3s git call.
        expect(Date.now() - started).toBeLessThan(2_500);
        expect(result.version).toBe("1.0.0");
        // Let the background refresh finish before the home is removed.
        await refreshMarketplaceCatalog(harnesstapDir, { name: "local-market", unattended: true });
        expect(readFileSync(git.log, "utf8")).toContain("clone");
      } finally {
        git.restore();
      }
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
