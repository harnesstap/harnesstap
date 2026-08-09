import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createTestContext } from "../helpers/db.ts";
import { createLayer, getLayerById } from "../../src/models/layer-model.ts";
import { addMarketplace } from "../../src/services/marketplace-registry.ts";
import {
  addPluginFromMarketplace,
  claudeSourceFromMarketplaceUrl,
} from "../../src/services/plugin-marketplace-add.ts";
import {
  clearActiveProfileName,
  setActiveProfileName,
} from "../../src/services/active-profile.ts";
import { attachPluginPinToLayer } from "../../src/services/layer-composition.ts";

function harnesstapDirFromContext(context: Awaited<ReturnType<typeof createTestContext>>) {
  return join(context.homeDir, ".harnesstap");
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

      const layer = createLayer({ name: "inactive-layer", tags: ["profile"] });
      const installCalls: unknown[] = [];
      const ensureCalls: unknown[] = [];

      const result = await addPluginFromMarketplace({
        harnesstapDir,
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
        ref: "formatter@acme-marketplace",
        layerName: layer.name,
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

      const refreshed = getLayerById(layer.id);
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

  it("installs when the layer matches the active profile", async () => {
    const context = await createTestContext("plugin-marketplace-add-active");
    try {
      context.schema.initializeSchema(context.connection.getDb());

      const harnesstapDir = harnesstapDirFromContext(context);
      addMarketplace(harnesstapDir, {
        name: "acme-marketplace",
        url: "https://github.com/acme/plugins",
        platforms: ["claude-code"],
      });

      const layer = createLayer({ name: "active-layer", tags: ["profile"] });
      setActiveProfileName(layer.name);

      const installCalls: unknown[] = [];
      const ensureCalls: unknown[] = [];

      const result = await addPluginFromMarketplace({
        harnesstapDir,
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
        ref: "formatter@acme-marketplace",
        layerName: layer.name,
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

      const layer = createLayer({ name: "already-layer" });
      attachPluginPinToLayer(layer.id, "formatter@acme-marketplace", "1.2.3");

      const result = await addPluginFromMarketplace({
        harnesstapDir,
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
        ref: "formatter@acme-marketplace",
        layerName: layer.name,
        versionConstraint: "1.2.3",
      });

      expect(result.status).toBe("already_attached");
      expect(result.marketplaceCopied).toBe(true);

      const refreshed = getLayerById(layer.id);
      expect(refreshed?.claude?.marketplaces?.["acme-marketplace"]).toEqual({
        source: { source: "github", repo: "acme/plugins" },
      });
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

      const layer = createLayer({ name: "cursor-layer" });

      const result = await addPluginFromMarketplace({
        harnesstapDir,
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
        ref: "formatter@cursor-marketplace",
        layerName: layer.name,
        versionConstraint: "2.0.0",
      });

      expect(result.status).toBe("attached");
      expect(result.marketplaceCopied).toBe(false);

      const refreshed = getLayerById(layer.id);
      expect(refreshed?.claude?.marketplaces).toBeUndefined();
      expect(refreshed?.claude?.plugins).toEqual([
        { id: "formatter@cursor-marketplace", version: "2.0.0", enabled: true },
      ]);
    } finally {
      await context.cleanup();
    }
  });
});
