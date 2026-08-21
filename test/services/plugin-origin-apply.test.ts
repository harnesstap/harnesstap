import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginById,
  getPluginResources,
  stampPluginOrigin,
} from "../../src/models/plugin-model.ts";
import { createResource, findResourceByKey } from "../../src/models/resource.ts";
import { setPluginOrigin } from "../../src/services/plugin-origin.ts";
import { resolveMarketplacePluginDirectory } from "../../src/services/plugin-origin-apply.ts";
import { updatePluginOrigins } from "../../src/services/plugin-origin-update.ts";
import { AP_SCHEMA_URL } from "../../src/services/agent-plugins/validate.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("origin-apply-");
});
afterEach(async () => {
  await ctx.cleanup();
});

function writePluginTree(root: string, name: string, version: string, skill: string): void {
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, "skills", skill), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name, version }),
  );
  writeFileSync(
    join(root, "skills", skill, "SKILL.md"),
    `---\nname: ${skill}\ndescription: ${skill}\n---\n# ${skill}\n`,
  );
}

it("resolves plugins/<name>, root <name>, and one-level nested <child>/<name>", () => {
  const cache = join(ctx.rootDir, "cache");
  mkdirSync(join(cache, "plugins", "alpha"), { recursive: true });
  expect(resolveMarketplacePluginDirectory(cache, "alpha")).toBe(
    join(cache, "plugins", "alpha"),
  );

  const rootCache = join(ctx.rootDir, "root-cache");
  mkdirSync(join(rootCache, "beta"), { recursive: true });
  expect(resolveMarketplacePluginDirectory(rootCache, "beta")).toBe(join(rootCache, "beta"));

  const nested = join(ctx.rootDir, "nested-cache");
  mkdirSync(join(nested, "team", "gamma"), { recursive: true });
  mkdirSync(join(nested, ".git"), { recursive: true });
  mkdirSync(join(nested, ".git", "gamma"), { recursive: true });
  expect(resolveMarketplacePluginDirectory(nested, "gamma")).toBe(
    join(nested, "team", "gamma"),
  );
  expect(resolveMarketplacePluginDirectory(nested, "missing")).toBeUndefined();
});

it("detaches disappeared type:name without deleting rows still attached elsewhere", async () => {
  const plugin = createPlugin({ name: "demo", version: "1.0.0", origin: "upstream" });
  setPluginOrigin(plugin.id, "upstream");
  stampPluginOrigin(plugin.id, {
    locator: "demo@mkt",
    fingerprint: "old",
    fingerprintKind: "git_sha",
  });
  const stale = createResource({
    type: "skill",
    name: "stale",
    description: "gone",
    content: "old",
    metadata: {},
    source: "test",
  });
  addResourceToPlugin(plugin.id, stale.id);
  const other = createPlugin({ name: "other", version: "1.0.0", origin: "authored" });
  addResourceToPlugin(other.id, stale.id);

  const originRoot = join(getHarnesstapDir(), "cache", "marketplaces", "mkt", "plugins", "demo");
  writePluginTree(originRoot, "demo", "1.2.0", "fresh");

  const report = await updatePluginOrigins({
    name: "demo",
    deps: {
      refreshMarketplace: async () => ({ ok: true, sha: "newsha", message: "ok" }),
      refreshGit: async () => ({ ok: true, sha: "newsha", message: "ok" }),
      listCatalogLatest: async () => ({ version: "1.0.0" }),
    },
  });
  expect(report.results[0]?.status).toBe("updated");
  const names = getPluginResources(plugin.id).map((r) => `${r.type}:${r.name}`);
  expect(names).toContain("skill:fresh");
  expect(names).not.toContain("skill:stale");
  expect(findResourceByKey("skill", "stale", "")?.id).toBe(stale.id);
  expect(getPluginResources(other.id).map((r) => r.id)).toEqual([stale.id]);
});

it("keeps local --as name for catalog updates", async () => {
  const plugin = createPlugin({
    name: "local-foundation",
    version: "1.0.0",
    origin: "catalog",
    org_slug: "acme",
    catalog_slug: "default",
  });
  setPluginOrigin(plugin.id, "catalog");
  stampPluginOrigin(plugin.id, {
    locator: "acme/default/foundation",
    fingerprint: "1.0.0",
    fingerprintKind: "catalog_version",
  });

  const report = await updatePluginOrigins({
    name: "local-foundation",
    deps: {
      refreshMarketplace: async () => ({ ok: true, sha: "x", message: "ok" }),
      refreshGit: async () => ({ ok: true, sha: "x", message: "ok" }),
      listCatalogLatest: async () => ({ version: "2.0.0" }),
      downloadCatalogPackage: async () => ({
        version: "2.0.0",
        files: {
          "plugin.json": {
            encoding: "utf8",
            content: JSON.stringify({
              $schema: AP_SCHEMA_URL,
              name: "foundation",
              version: "2.0.0",
            }),
          },
          "skills/core/SKILL.md": {
            encoding: "utf8",
            content: "---\nname: core\ndescription: core\n---\n# core\n",
          },
        },
      }),
    },
  });
  expect(report.results[0]?.status).toBe("updated");
  const after = getPluginById(plugin.id)!;
  expect(after.name).toBe("local-foundation");
  expect(after.version).toBe("2.0.0");
  expect(getPluginResources(plugin.id).some((r) => r.name === "core")).toBe(true);
});

it("fails catalog apply with sign-in copy on 401 without throwing", async () => {
  const plugin = createPlugin({
    name: "foundation",
    version: "1.0.0",
    origin: "catalog",
    org_slug: "acme",
    catalog_slug: "default",
  });
  setPluginOrigin(plugin.id, "catalog");
  stampPluginOrigin(plugin.id, {
    locator: "acme/default/foundation",
    fingerprint: "1.0.0",
    fingerprintKind: "catalog_version",
  });
  const report = await updatePluginOrigins({
    name: "foundation",
    deps: {
      listCatalogLatest: async () => ({ version: "2.0.0" }),
      downloadCatalogPackage: async () => {
        throw new Error("Failed to download acme/default/foundation: 401");
      },
      refreshMarketplace: async () => ({ ok: true, sha: "x", message: "ok" }),
      refreshGit: async () => ({ ok: true, sha: "x", message: "ok" }),
    },
  });
  expect(report.results[0]?.status).toBe("failed");
  expect(report.results[0]?.message?.toLowerCase()).toMatch(/sign in/);
  expect(report.summary.failed).toBe(1);
});
