import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir } from "../helpers/fs.ts";
import { createResource, getResource } from "../../src/models/resource.ts";
import {
  listHostPluginVersions,
  pullHostPluginVersions,
  resolvedVersionFromInstallRoot,
  retargetHostPluginVersion,
} from "../../src/services/host-plugin-versions.ts";
import { parseMarketplacePluginSource } from "../../src/services/host-plugin-source.ts";
import {
  resolveInstallRoot,
  switchHostPluginCacheVersion,
} from "../../src/services/resource-sync.ts";

function writePluginCache(
  homeDir: string,
  marketplace: string,
  name: string,
  version: string,
  manifestVersion = version,
): string {
  const root = join(
    homeDir,
    ".claude",
    "plugins",
    "cache",
    marketplace,
    name,
    version,
  );
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name,
      version: manifestVersion,
      description: `${name} ${version}`,
    }),
  );
  return root;
}

function writeMarketplaceCatalog(
  homeDir: string,
  marketplace: string,
  pluginName: string,
  version: string,
): void {
  const dir = join(
    homeDir,
    ".claude",
    "plugins",
    "marketplaces",
    marketplace,
    ".claude-plugin",
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "marketplace.json"),
    JSON.stringify({
      name: marketplace,
      plugins: [{ name: pluginName, version }],
    }),
  );
}

function writeInstalled(
  homeDir: string,
  ref: string,
  installPath: string,
  version: string,
): void {
  const path = join(homeDir, ".claude", "plugins", "installed_plugins.json");
  mkdirSync(join(path, ".."), { recursive: true });
  let file: { version: number; plugins: Record<string, unknown[]> } = {
    version: 2,
    plugins: {},
  };
  try {
    file = JSON.parse(readFileSync(path, "utf8")) as typeof file;
  } catch {
    file = { version: 2, plugins: {} };
  }
  file.plugins[ref] = [{ scope: "user", installPath, version }];
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}

describe("host plugin cache versions", () => {
  it("lists cache dirs, current install, and marketplace advertised version", async () => {
    const ctx = await createInitializedTestContext("host-plugin-versions-list");
    try {
      writePluginCache(ctx.homeDir, "claude-plugins-official", "superpowers", "5.1.0");
      writePluginCache(ctx.homeDir, "claude-plugins-official", "superpowers", "6.2.0");
      writePluginCache(
        ctx.homeDir,
        "claude-plugins-official",
        "superpowers",
        "6.3.0",
        "5.1.0",
      );
      writeMarketplaceCatalog(
        ctx.homeDir,
        "claude-plugins-official",
        "superpowers",
        "6.2.0",
      );
      writeInstalled(
        ctx.homeDir,
        "superpowers@claude-plugins-official",
        "cache/claude-plugins-official/superpowers/5.1.0",
        "5.1.0",
      );

      const info = listHostPluginVersions(
        "superpowers@claude-plugins-official",
        ctx.homeDir,
      );
      expect(info.current_version).toBe("5.1.0");
      expect(info.advertised_version).toBe("6.2.0");
      expect(info.available_versions.map((row) => row.version)).toEqual([
        "6.3.0",
        "6.2.0",
        "5.1.0",
      ]);
      expect(info.available_versions.find((row) => row.version === "6.3.0")).toMatchObject({
        manifest_version: "5.1.0",
        current: false,
        advertised: false,
      });
      expect(info.available_versions.find((row) => row.version === "6.2.0")).toMatchObject({
        advertised: true,
        current: false,
      });
      expect(info.available_versions.find((row) => row.version === "5.1.0")?.current).toBe(
        true,
      );
    } finally {
      await ctx.cleanup();
    }
  });

  it("does not use a sibling marketplace install as the current version", async () => {
    const ctx = await createInitializedTestContext("host-plugin-versions-exact");
    try {
      writePluginCache(ctx.homeDir, "claude-plugins-official", "superpowers", "5.1.0");
      writePluginCache(ctx.homeDir, "superpowers-dev", "superpowers", "5.1.0");
      writeInstalled(
        ctx.homeDir,
        "superpowers@claude-plugins-official",
        "cache/claude-plugins-official/superpowers/5.1.0",
        "5.1.0",
      );
      writeInstalled(
        ctx.homeDir,
        "superpowers@superpowers-dev",
        "cache/superpowers-dev/superpowers/5.1.0",
        "5.1.0",
      );

      const official = resolveInstallRoot(
        "superpowers@superpowers-dev",
        ctx.homeDir,
      );
      expect(official).toBe(
        join(
          ctx.homeDir,
          ".claude",
          "plugins",
          "cache",
          "superpowers-dev",
          "superpowers",
          "5.1.0",
        ),
      );
    } finally {
      await ctx.cleanup();
    }
  });

  it("retargets installed_plugins.json and syncs the library pin", async () => {
    const ctx = await createInitializedTestContext("host-plugin-versions-switch");
    try {
      writePluginCache(ctx.homeDir, "team-mkt", "demo", "1.0.0");
      const next = writePluginCache(ctx.homeDir, "team-mkt", "demo", "2.0.0");
      writeInstalled(
        ctx.homeDir,
        "demo@team-mkt",
        "cache/team-mkt/demo/1.0.0",
        "1.0.0",
      );
      const pin = createResource({
        type: "plugin",
        name: "demo",
        namespace: "team-mkt",
        description: "Plugin pin: demo@team-mkt",
        content: "{}",
        metadata: { resolved_version: "1.0.0" },
        source: "composition:plugin",
        origin_kind: "marketplace_link",
        origin_ref: "demo@team-mkt",
      });

      const result = await switchHostPluginCacheVersion({
        resource: pin,
        version: "2.0.0",
        homeRoot: ctx.homeDir,
      });
      expect(result.version).toBe("2.0.0");
      expect(result.install_path).toBe(next);

      const installed = JSON.parse(
        readFileSync(
          join(ctx.homeDir, ".claude", "plugins", "installed_plugins.json"),
          "utf8",
        ),
      ) as { plugins: Record<string, Array<{ version: string; installPath: string }>> };
      expect(installed.plugins["demo@team-mkt"]?.[0]).toMatchObject({
        version: "2.0.0",
        installPath: "cache/team-mkt/demo/2.0.0",
      });
      expect(
        (getResource(pin.id)?.metadata as { resolved_version?: string }).resolved_version,
      ).toBe("2.0.0");
    } finally {
      await ctx.cleanup();
    }
  });

  it("keeps the cache directory name when plugin.json disagrees", () => {
    expect(
      resolvedVersionFromInstallRoot("/tmp/cache/mkt/demo/6.3.0", "5.1.0"),
    ).toBe("6.3.0");
  });

  it("rejects a version that is not in cache", async () => {
    const ctx = await createInitializedTestContext("host-plugin-versions-missing");
    try {
      writePluginCache(ctx.homeDir, "team-mkt", "demo", "1.0.0");
      expect(() =>
        retargetHostPluginVersion({
          originRef: "demo@team-mkt",
          version: "9.9.9",
          homeRoot: ctx.homeDir,
        }),
      ).toThrow("9.9.9");
    } finally {
      await ctx.cleanup();
    }
  });

  it("includes the advertised marketplace version even when it is not cached", async () => {
    const ctx = await createInitializedTestContext("host-plugin-versions-advertised");
    try {
      writePluginCache(ctx.homeDir, "team-mkt", "demo", "5.1.0");
      writeMarketplaceCatalog(ctx.homeDir, "team-mkt", "demo", "6.1.1");
      writeInstalled(
        ctx.homeDir,
        "demo@team-mkt",
        "cache/team-mkt/demo/5.1.0",
        "5.1.0",
      );
      const info = listHostPluginVersions("demo@team-mkt", ctx.homeDir);
      expect(info.current_version).toBe("5.1.0");
      expect(info.advertised_version).toBe("6.1.1");
      expect(info.available_versions.map((row) => row.version)).toEqual([
        "6.1.1",
        "5.1.0",
      ]);
      expect(info.available_versions.find((row) => row.version === "6.1.1")?.path).toBe(
        "",
      );
    } finally {
      await ctx.cleanup();
    }
  });
});

describe("marketplace plugin source parse", () => {
  it("reads url, github, and path sources", () => {
    expect(
      parseMarketplacePluginSource({
        name: "superpowers",
        version: "6.3.0",
        source: { source: "url", url: "https://github.com/obra/superpowers.git" },
      }),
    ).toEqual({
      version: "6.3.0",
      url: "https://github.com/obra/superpowers.git",
      gitRef: null,
      path: null,
    });
    expect(
      parseMarketplacePluginSource({
        name: "local",
        version: "1.2.3",
        source: { source: "url", url: "file:///tmp/plugin-src" },
      }),
    ).toMatchObject({
      url: "file:///tmp/plugin-src",
    });
    expect(
      parseMarketplacePluginSource({
        name: "superpowers",
        version: "6.3.0",
        source: { source: "github", repo: "obra/superpowers" },
      }),
    ).toMatchObject({
      version: "6.3.0",
      url: "https://github.com/obra/superpowers.git",
    });
    expect(
      parseMarketplacePluginSource({
        name: "nested",
        version: "1.0.0",
        source: "./plugins/nested",
      }),
    ).toEqual({
      version: "1.0.0",
      url: null,
      gitRef: null,
      path: "./plugins/nested",
    });
  });
});

function git(cwd: string, args: string): string {
  return execSync(`git -c user.email=test@example.com -c user.name=Test ${args}`, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function writePluginTree(root: string, name: string, version: string): void {
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, "skills", name), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name, version, description: `${name} ${version}` }),
  );
  writeFileSync(
    join(root, "skills", name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name}\n---\n# ${version}\n`,
  );
}

function createVersionedPluginRepo(name: string): { dir: string; url: string } {
  const dir = createTempDir("host-plugin-src-");
  git(dir, "init -b main");
  for (const version of ["5.1.0", "6.1.1", "6.3.0"]) {
    writePluginTree(dir, name, version);
    git(dir, "add -A");
    git(dir, `commit -m v${version}`);
    git(dir, `tag v${version}`);
  }
  return { dir, url: `file://${dir}` };
}

function writeMarketplaceManifest(
  root: string,
  marketplace: string,
  pluginName: string,
  pluginUrl: string,
  version: string,
): void {
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: marketplace,
      plugins: [
        {
          name: pluginName,
          version,
          source: { source: "url", url: pluginUrl },
        },
      ],
    }),
  );
}

describe("host plugin source pull and download", () => {
  it("pulls git tags from the plugin source and applies a selected version", async () => {
    const ctx = await createInitializedTestContext("host-plugin-pull");
    const plugin = createVersionedPluginRepo("superpowers");
    const marketplaceRepo = createTempDir("host-plugin-mkt-");
    try {
      git(marketplaceRepo, "init -b main");
      writeMarketplaceManifest(
        marketplaceRepo,
        "superpowers-marketplace",
        "superpowers",
        plugin.url,
        "6.1.1",
      );
      git(marketplaceRepo, "add -A");
      git(marketplaceRepo, "commit -m advertised-6.1.1");
      writeMarketplaceManifest(
        marketplaceRepo,
        "superpowers-marketplace",
        "superpowers",
        plugin.url,
        "6.3.0",
      );
      git(marketplaceRepo, "add -A");
      git(marketplaceRepo, "commit -m advertised-6.3.0");

      const marketplaceRoot = join(
        ctx.homeDir,
        ".claude",
        "plugins",
        "marketplaces",
        "superpowers-marketplace",
      );
      mkdirSync(join(marketplaceRoot, ".."), { recursive: true });
      execSync(
        `git -c protocol.file.allow=always clone ${marketplaceRepo} ${marketplaceRoot}`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      git(marketplaceRoot, "reset --hard HEAD~1");

      mkdirSync(join(ctx.homeDir, ".claude", "plugins"), { recursive: true });
      writeFileSync(
        join(ctx.homeDir, ".claude", "plugins", "known_marketplaces.json"),
        JSON.stringify({
          "superpowers-marketplace": {
            source: { source: "url", url: `file://${marketplaceRepo}` },
            installLocation: marketplaceRoot,
          },
        }),
      );

      writePluginCache(ctx.homeDir, "superpowers-marketplace", "superpowers", "5.1.0");
      writeInstalled(
        ctx.homeDir,
        "superpowers@superpowers-marketplace",
        "cache/superpowers-marketplace/superpowers/5.1.0",
        "5.1.0",
      );
      const pin = createResource({
        type: "plugin",
        name: "superpowers",
        namespace: "superpowers-marketplace",
        description: "Plugin pin: superpowers@superpowers-marketplace",
        content: "{}",
        metadata: { resolved_version: "5.1.0" },
        source: "composition:plugin",
        origin_kind: "marketplace_link",
        origin_ref: "superpowers@superpowers-marketplace",
      });

      const before = listHostPluginVersions(
        "superpowers@superpowers-marketplace",
        ctx.homeDir,
      );
      expect(before.current_version).toBe("5.1.0");
      expect(before.advertised_version).toBe("6.1.1");
      expect(before.available_versions.map((row) => row.version)).toEqual([
        "6.1.1",
        "5.1.0",
      ]);

      const pulled = pullHostPluginVersions({
        originRef: "superpowers@superpowers-marketplace",
        homeRoot: ctx.homeDir,
      });
      expect(pulled.advertised_version).toBe("6.3.0");
      expect(pulled.available_versions.map((row) => row.version)).toEqual([
        "6.3.0",
        "6.1.1",
        "5.1.0",
      ]);

      const switched = await switchHostPluginCacheVersion({
        resource: pin,
        version: "6.3.0",
        homeRoot: ctx.homeDir,
      });
      expect(switched.version).toBe("6.3.0");
      expect(switched.install_path).toContain("/6.3.0");
      const installed = JSON.parse(
        readFileSync(
          join(ctx.homeDir, ".claude", "plugins", "installed_plugins.json"),
          "utf8",
        ),
      ) as { plugins: Record<string, Array<{ version: string; installPath: string }>> };
      expect(
        installed.plugins["superpowers@superpowers-marketplace"]?.[0],
      ).toMatchObject({
        version: "6.3.0",
        installPath: "cache/superpowers-marketplace/superpowers/6.3.0",
      });
    } finally {
      cleanupDir(plugin.dir);
      cleanupDir(marketplaceRepo);
      await ctx.cleanup();
    }
  });
});
