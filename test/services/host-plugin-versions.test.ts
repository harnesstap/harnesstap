import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createResource, getResource } from "../../src/models/resource.ts";
import {
  listHostPluginVersions,
  resolvedVersionFromInstallRoot,
  retargetHostPluginVersion,
} from "../../src/services/host-plugin-versions.ts";
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
});
