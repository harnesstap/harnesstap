import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import {
  createPlugin,
  getPluginByName,
  getPluginResources,
} from "../../src/models/plugin-model.ts";
import { addMarketplace } from "../../src/services/marketplace-registry.ts";
import {
  importPluginFromMarketplace,
  type MarketplacePluginImportError,
} from "../../src/services/plugin-marketplace-import.ts";
import { getPluginOrigin } from "../../src/services/plugin-origin.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("mkt-import-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function writeMarketplacePlugin(marketplace: string, name: string, version: string): void {
  const originRoot = join(
    getHarnesstapDir(),
    "cache",
    "marketplaces",
    marketplace,
    "plugins",
    name,
  );
  mkdirSync(join(originRoot, ".claude-plugin"), { recursive: true });
  mkdirSync(join(originRoot, "skills", "hello"), { recursive: true });
  writeFileSync(
    join(originRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name, version, description: `${name} from ${marketplace}` }),
  );
  writeFileSync(
    join(originRoot, "skills", "hello", "SKILL.md"),
    "---\nname: hello\ndescription: hello\n---\n# hello\n",
  );
}

function registerMarketplace(name: string): void {
  addMarketplace(getHarnesstapDir(), {
    name,
    url: "https://github.com/acme/plugins.git",
    platforms: ["claude-code"],
  });
}

describe("importPluginFromMarketplace", () => {
  it("imports as an upstream plugin with the marketplace locator", async () => {
    registerMarketplace("claude-plugins");
    writeMarketplacePlugin("claude-plugins", "code-review-workflow", "1.2.0");

    const imported = await importPluginFromMarketplace({
      marketplace: "claude-plugins",
      plugin: "code-review-workflow",
      refreshMarketplace: async () => ({ ok: true, sha: "abc123def456", message: "ok" }),
    });

    expect(imported.created).toBe(true);
    expect(imported.origin_locator).toBe("code-review-workflow@claude-plugins");
    expect(imported.origin_fingerprint).toBe("abc123def456");
    expect(imported.plugin.name).toBe("code-review-workflow");
    expect(imported.plugin.origin).toBe("upstream");
    expect(getPluginOrigin(imported.plugin.id)).toBe("upstream");
    const stored = getPluginByName("code-review-workflow");
    expect(stored?.origin).toBe("upstream");
    expect(stored?.origin_locator).toBe("code-review-workflow@claude-plugins");
    expect(stored?.origin_fingerprint).toBe("abc123def456");
    expect(getPluginResources(imported.plugin.id).some((row) => row.name === "hello")).toBe(
      true,
    );
  });

  it("reuses an existing upstream plugin from the same marketplace", async () => {
    registerMarketplace("claude-plugins");
    writeMarketplacePlugin("claude-plugins", "alpha", "1.0.0");
    const first = await importPluginFromMarketplace({
      marketplace: "claude-plugins",
      plugin: "alpha",
      refreshMarketplace: async () => ({ ok: true, sha: "oldsha", message: "ok" }),
    });
    writeMarketplacePlugin("claude-plugins", "alpha", "1.1.0");
    const second = await importPluginFromMarketplace({
      marketplace: "claude-plugins",
      plugin: "alpha",
      refreshMarketplace: async () => ({ ok: true, sha: "newsha", message: "ok" }),
    });
    expect(second.created).toBe(false);
    expect(second.plugin.id).toBe(first.plugin.id);
    expect(getPluginByName("alpha")?.origin_fingerprint).toBe("newsha");
    expect(getPluginByName("alpha")?.version).toBe("1.1.0");
  });

  it("refuses to overwrite an authored plugin of the same name", async () => {
    registerMarketplace("claude-plugins");
    writeMarketplacePlugin("claude-plugins", "mine", "1.0.0");
    createPlugin({ name: "mine", origin: "authored" });
    expect(
      importPluginFromMarketplace({
        marketplace: "claude-plugins",
        plugin: "mine",
        refreshMarketplace: async () => ({ ok: true, sha: "abc", message: "ok" }),
      }),
    ).rejects.toMatchObject({
      code: "name_conflict",
    } satisfies Partial<MarketplacePluginImportError>);
    expect(getPluginByName("mine")?.origin).toBe("authored");
  });

  it("imports under --as without wrapping in an authored plugin", async () => {
    registerMarketplace("claude-plugins");
    writeMarketplacePlugin("claude-plugins", "alpha", "1.0.0");
    createPlugin({ name: "alpha", origin: "authored" });
    const imported = await importPluginFromMarketplace({
      marketplace: "claude-plugins",
      plugin: "alpha",
      as: "alpha-remote",
      refreshMarketplace: async () => ({ ok: true, sha: "abc", message: "ok" }),
    });
    expect(imported.plugin.name).toBe("alpha-remote");
    expect(imported.plugin.origin).toBe("upstream");
    expect(imported.origin_locator).toBe("alpha@claude-plugins");
    expect(getPluginByName("alpha")?.origin).toBe("authored");
  });
});
