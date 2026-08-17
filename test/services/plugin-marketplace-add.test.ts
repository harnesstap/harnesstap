import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createTestContext } from "../helpers/db.ts";
import { createPlugin, getPluginById } from "../../src/models/plugin-model.ts";
import { addMarketplace } from "../../src/services/marketplace-registry.ts";
import {
  addPluginFromMarketplace,
  claudeSourceFromMarketplaceUrl,
} from "../../src/services/plugin-marketplace-add.ts";
import {
  clearActiveProfileName,
  setActiveProfileName,
} from "../../src/services/active-profile.ts";
import { attachPluginPinToPlugin } from "../../src/services/plugin-composition.ts";

function harnesstapDirFromContext(context: Awaited<ReturnType<typeof createTestContext>>) {
  return join(context.homeDir, ".harnesstap");
}

function initLocalMarketplaceRepo(manifestName: string): string {
  const repo = mkdtempSync(join(tmpdir(), "ht-mkt-repo-"));
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: manifestName,
      plugins: [{ name: "alpha", version: "1.0.0" }],
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

describe("claudeSourceFromMarketplaceUrl", () => {
  it("maps github URLs to github source entries", () => {
    expect(claudeSourceFromMarketplaceUrl("https://github.com/acme/plugins.git")).toEqual({
      source: "github",
      repo: "acme/plugins",
    });
    expect(claudeSourceFromMarketplaceUrl("github.com/acme/plugins")).toEqual({
      source: "github",
      repo: "acme/plugins",
    });
  });

  it("maps non-github URLs to url source entries", () => {
    expect(claudeSourceFromMarketplaceUrl("https://example.com/marketplace")).toEqual({
      source: "url",
      url: "https://example.com/marketplace",
    });
  });
});

describe("addPluginFromMarketplace", () => {
  it("attaches pin and copies marketplace when profile is inactive without installing", async () => {
    const context = await createTestContext("plugin-marketplace-add-inactive");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      clearActiveProfileName();

      const harnesstapDir = harnesstapDirFromContext(context);
      addMarketplace(harnesstapDir, {
        name: "acme-marketplace",
        url: "https://github.com/acme/plugins.git",
        platforms: ["claude-code"],
      });

      const plugin = createPlugin({ name: "inactive-plugin", tags: ["profile"] });
      const installCalls: unknown[] = [];
      const ensureCalls: unknown[] = [];

      const result = await addPluginFromMarketplace({
        harnesstapDir,
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
        ref: "formatter@acme-marketplace",
        pluginName: plugin.name,
        versionConstraint: "1.2.3",
        install: async (opts) => {
          installCalls.push(opts);
          return {
            ref: opts.ref,
            platformId: "claude-code",
            scope: opts.scope,
            status: "installed",
            message: "ok",
          };
        },
        ensureMarketplaces: (config, options) => {
          ensureCalls.push({ config, options });
          return [];
        },
      });

      expect(result.status).toBe("attached");
      expect(result.marketplaceCopied).toBe(true);
      expect(result.install).toBeUndefined();
      expect(installCalls).toEqual([]);
      expect(ensureCalls).toEqual([]);

      const refreshed = getPluginById(plugin.id);
      expect(refreshed?.claude?.marketplaces?.["acme-marketplace"]).toEqual({
        source: { source: "github", repo: "acme/plugins" },
      });
      expect(refreshed?.claude?.plugins).toEqual([
        { id: "formatter@acme-marketplace", version: "1.2.3", enabled: true },
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("installs when the plugin matches the active profile", async () => {
    const context = await createTestContext("plugin-marketplace-add-active");
    try {
      context.schema.initializeSchema(context.connection.getDb());

      const harnesstapDir = harnesstapDirFromContext(context);
      addMarketplace(harnesstapDir, {
        name: "acme-marketplace",
        url: "https://github.com/acme/plugins",
        platforms: ["claude-code"],
      });

      const plugin = createPlugin({ name: "active-plugin", tags: ["profile"] });
      setActiveProfileName(plugin.name);

      const installCalls: unknown[] = [];
      const ensureCalls: unknown[] = [];

      const result = await addPluginFromMarketplace({
        harnesstapDir,
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
        ref: "formatter@acme-marketplace",
        pluginName: plugin.name,
        versionConstraint: "1.2.3",
        install: async (opts) => {
          installCalls.push(opts);
          return {
            ref: opts.ref,
            platformId: opts.installPlatformId ?? "claude-code",
            scope: opts.scope,
            status: "installed",
            message: "ok",
          };
        },
        ensureMarketplaces: (config, options) => {
          ensureCalls.push({ config, options });
          return [];
        },
      });

      expect(result.status).toBe("attached");
      expect(result.install?.status).toBe("installed");
      expect(installCalls).toHaveLength(1);
      expect(ensureCalls).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });

  it("returns already_attached but still copies marketplace when missing", async () => {
    const context = await createTestContext("plugin-marketplace-add-already");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      clearActiveProfileName();

      const harnesstapDir = harnesstapDirFromContext(context);
      addMarketplace(harnesstapDir, {
        name: "acme-marketplace",
        url: "https://github.com/acme/plugins",
        platforms: ["claude-code"],
      });

      const plugin = createPlugin({ name: "already-plugin" });
      attachPluginPinToPlugin(plugin.id, "formatter@acme-marketplace", "1.2.3");

      const result = await addPluginFromMarketplace({
        harnesstapDir,
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
        ref: "formatter@acme-marketplace",
        pluginName: plugin.name,
        versionConstraint: "1.2.3",
      });

      expect(result.status).toBe("already_attached");
      expect(result.marketplaceCopied).toBe(true);

      const refreshed = getPluginById(plugin.id);
      expect(refreshed?.claude?.marketplaces?.["acme-marketplace"]).toEqual({
        source: { source: "github", repo: "acme/plugins" },
      });
    } finally {
      await context.cleanup();
    }
  });

  it("adds plugin when ref uses registry name not manifest name", async () => {
    const context = await createTestContext("plugin-marketplace-add-registry-name");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      clearActiveProfileName();

      const harnesstapDir = harnesstapDirFromContext(context);
      const repo = initLocalMarketplaceRepo("acme-plugins");
      addMarketplace(harnesstapDir, {
        name: "team",
        url: repo,
        platforms: ["claude-code"],
      });

      const plugin = createPlugin({ name: "registry-name-plugin" });

      const result = await addPluginFromMarketplace({
        harnesstapDir,
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
        ref: "alpha@team",
        pluginName: plugin.name,
        versionConstraint: "1.0.0",
      });

      expect(result.status).toBe("attached");
      expect(result.marketplaceCopied).toBe(true);

      const refreshed = getPluginById(plugin.id);
      expect(refreshed?.claude?.marketplaces?.["team"]).toEqual({
        source: { source: "url", url: repo },
      });
      expect(refreshed?.claude?.plugins).toEqual([
        { id: "alpha@team", version: "1.0.0", enabled: true },
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("attaches pin for cursor-only marketplaces without writing claude marketplaces", async () => {
    const context = await createTestContext("plugin-marketplace-add-cursor");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      clearActiveProfileName();

      const harnesstapDir = harnesstapDirFromContext(context);
      addMarketplace(harnesstapDir, {
        name: "cursor-marketplace",
        url: "https://example.com/cursor-marketplace",
        platforms: ["cursor"],
      });

      const plugin = createPlugin({ name: "cursor-plugin" });

      const result = await addPluginFromMarketplace({
        harnesstapDir,
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
        ref: "formatter@cursor-marketplace",
        pluginName: plugin.name,
        versionConstraint: "2.0.0",
      });

      expect(result.status).toBe("attached");
      expect(result.marketplaceCopied).toBe(false);

      const refreshed = getPluginById(plugin.id);
      expect(refreshed?.claude?.marketplaces).toBeUndefined();
      expect(refreshed?.claude?.plugins).toEqual([
        { id: "formatter@cursor-marketplace", version: "2.0.0", enabled: true },
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("registers cursor marketplaces with agent when the plugin is the active profile", async () => {
    const context = await createTestContext("plugin-marketplace-add-cursor-ensure");
    try {
      context.schema.initializeSchema(context.connection.getDb());

      const harnesstapDir = harnesstapDirFromContext(context);
      addMarketplace(harnesstapDir, {
        name: "cursor-marketplace",
        url: "https://github.com/acme/cursor-plugins",
        platforms: ["cursor"],
      });

      const plugin = createPlugin({ name: "cursor-active", tags: ["profile"] });
      setActiveProfileName(plugin.name);

      const cursorEnsureCalls: unknown[] = [];
      const result = await addPluginFromMarketplace({
        harnesstapDir,
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
        ref: "formatter@cursor-marketplace",
        pluginName: plugin.name,
        versionConstraint: "2.0.0",
        install: async (opts) => ({
          ref: opts.ref,
          platformId: opts.installPlatformId ?? "cursor",
          scope: opts.scope,
          status: "unsupported",
          message: "ok",
        }),
        ensureCursorMarketplaces: (entries, options) => {
          cursorEnsureCalls.push({ entries, options });
          return { added: entries.map((entry) => entry.name), skipped: [] };
        },
      });

      expect(result.status).toBe("attached");
      expect(result.install?.platformId).toBe("cursor");
      expect(cursorEnsureCalls).toEqual([
        {
          entries: [
            {
              name: "cursor-marketplace",
              url: "https://github.com/acme/cursor-plugins",
            },
          ],
          options: {
            homeRoot: context.homeDir,
            projectRoot: context.projectDir,
          },
        },
      ]);
    } finally {
      await context.cleanup();
    }
  });
});
