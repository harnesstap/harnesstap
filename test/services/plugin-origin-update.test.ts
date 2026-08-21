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
import { createResource } from "../../src/models/resource.ts";
import { setPluginOrigin } from "../../src/services/plugin-origin.ts";
import { checkPluginOrigins } from "../../src/services/plugin-origin-update.ts";
import { scanPluginSource } from "../../src/services/plugin-source-import.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

const stubDeps = {
  refreshMarketplace: async () => ({ ok: true, sha: "aaa", message: "ok" }),
  refreshGit: async () => ({ ok: true, sha: "aaa", message: "ok" }),
  listCatalogLatest: async () => ({ version: "1.0.0" }),
};

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("origin-update-");
});
afterEach(async () => {
  await ctx.cleanup();
});

function createUpstream(name: string, locator: string, fingerprint?: string) {
  const plugin = createPlugin({ name, version: "1.0.0", origin: "upstream" });
  setPluginOrigin(plugin.id, "upstream");
  stampPluginOrigin(plugin.id, {
    locator,
    ...(fingerprint
      ? { fingerprint, fingerprintKind: "git_sha" as const }
      : {}),
  });
  const stamped = getPluginById(plugin.id);
  if (!stamped) {
    throw new Error(`Plugin not found after stamp: ${plugin.id}`);
  }
  return stamped;
}

it("marks marketplace plugins current when stored SHA matches fetched HEAD", async () => {
  createUpstream("demo", "demo@mkt", "aaa");
  const report = await checkPluginOrigins({
    deps: {
      refreshMarketplace: async () => ({ ok: true, sha: "aaa", message: "ok" }),
      refreshGit: async () => ({ ok: true, sha: "aaa", message: "ok" }),
      listCatalogLatest: async () => ({ version: "1.0.0" }),
    },
  });
  expect(report.results[0]?.status).toBe("current");
});

it("marks every plugin on a marketplace outdated when HEAD SHA moved", async () => {
  createUpstream("a", "a@mkt", "old");
  createUpstream("b", "b@mkt", "old");
  const report = await checkPluginOrigins({
    deps: {
      refreshMarketplace: async () => ({ ok: true, sha: "new", message: "ok" }),
      refreshGit: async () => ({ ok: true, sha: "new", message: "ok" }),
      listCatalogLatest: async () => ({ version: "1.0.0" }),
    },
  });
  expect(report.results.every((r) => r.status === "outdated")).toBe(true);
});

it("fetches each marketplace once per run", async () => {
  createUpstream("a", "a@mkt", "abc");
  createUpstream("b", "b@mkt", "abc");
  let calls = 0;
  await checkPluginOrigins({
    deps: {
      refreshMarketplace: async () => {
        calls += 1;
        return { ok: true, sha: "abc", message: "ok" };
      },
      refreshGit: async () => ({ ok: true, sha: "abc", message: "ok" }),
      listCatalogLatest: async () => ({ version: "1.0.0" }),
    },
  });
  expect(calls).toBe(1);
});

it("stamps fingerprint without replacing files when empty fingerprint already matches origin content", async () => {
  const plugin = createUpstream("demo", "demo@mkt");
  const originRoot = join(
    getHarnesstapDir(),
    "cache",
    "marketplaces",
    "mkt",
    "plugins",
    "demo",
  );
  mkdirSync(join(originRoot, ".claude-plugin"), { recursive: true });
  mkdirSync(join(originRoot, "skills", "hello"), { recursive: true });
  writeFileSync(
    join(originRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "demo", version: "1.0.0" }),
  );
  writeFileSync(
    join(originRoot, "skills", "hello", "SKILL.md"),
    "---\nname: hello\ndescription: hi\n---\n# hello body\n",
  );
  const scanned = await scanPluginSource(originRoot);
  for (const resource of scanned[0]?.resources ?? []) {
    const created = createResource(resource);
    addResourceToPlugin(plugin.id, created.id);
  }
  const before = getPluginResources(plugin.id).map((r) => ({
    id: r.id,
    content: r.content,
    content_hash: r.content_hash,
  }));
  expect(before.length).toBeGreaterThan(0);

  const report = await checkPluginOrigins({ deps: stubDeps });
  expect(report.results[0]?.status).toBe("current");
  const stamped = getPluginById(plugin.id);
  expect(stamped?.origin_fingerprint).toBe("aaa");
  expect(stamped?.origin_fingerprint_kind).toBe("git_sha");
  expect(
    getPluginResources(plugin.id).map((r) => ({
      id: r.id,
      content: r.content,
      content_hash: r.content_hash,
    })),
  ).toEqual(before);
});

it("catalog auth failure is error with sign-in copy, not thrown", async () => {
  const plugin = createPlugin({
    name: "foundation",
    version: "1.0.0",
    origin: "catalog",
    org_slug: "acme",
    catalog_slug: "default",
  });
  setPluginOrigin(plugin.id, "catalog");
  stampPluginOrigin(plugin.id, { locator: "acme/default/foundation" });
  const report = await checkPluginOrigins({
    name: "foundation",
    deps: {
      listCatalogLatest: async () => ({ error: "auth", authRequired: true }),
      refreshMarketplace: async () => ({ ok: true, sha: "x", message: "ok" }),
      refreshGit: async () => ({ ok: true, sha: "x", message: "ok" }),
    },
  });
  expect(report.results[0]?.status).toBe("error");
  expect(report.results[0]?.message?.toLowerCase()).toMatch(/sign in/);
});

it("authored named check is unknown with no-upstream copy", async () => {
  createPlugin({ name: "mine", version: "1.0.0" });
  const report = await checkPluginOrigins({ name: "mine", deps: stubDeps });
  expect(report.results).toHaveLength(1);
  expect(report.results[0]?.status).toBe("unknown");
  expect(report.results[0]?.message).toBe(
    "authored plugin; there is no upstream to sync from",
  );
});

it("duplicate locator non-targets are current because another working head owns this origin", async () => {
  const low = createPlugin({ name: "demo", version: "1.0.0", origin: "upstream" });
  const high = createPlugin({ name: "demo", version: "1.2.0", origin: "upstream" });
  setPluginOrigin(low.id, "upstream");
  setPluginOrigin(high.id, "upstream");
  stampPluginOrigin(low.id, {
    locator: "demo@mkt",
    fingerprint: "old",
    fingerprintKind: "git_sha",
  });
  stampPluginOrigin(high.id, {
    locator: "demo@mkt",
    fingerprint: "old",
    fingerprintKind: "git_sha",
  });
  const report = await checkPluginOrigins({
    deps: {
      refreshMarketplace: async () => ({ ok: true, sha: "new", message: "ok" }),
      refreshGit: async () => ({ ok: true, sha: "new", message: "ok" }),
      listCatalogLatest: async () => ({ version: "1.0.0" }),
    },
  });
  const skipped = report.results.find((r) => r.plugin_id === low.id);
  const target = report.results.find((r) => r.plugin_id === high.id);
  expect(target?.status).toBe("outdated");
  expect(skipped?.status).toBe("current");
  expect(skipped?.message).toBe("another working head owns this origin");
});

it("marks skipped duplicates error with the same fetch message when the origin fetch fails", async () => {
  const low = createPlugin({ name: "demo", version: "1.0.0", origin: "upstream" });
  const high = createPlugin({ name: "demo", version: "1.2.0", origin: "upstream" });
  setPluginOrigin(low.id, "upstream");
  setPluginOrigin(high.id, "upstream");
  stampPluginOrigin(low.id, {
    locator: "demo@mkt",
    fingerprint: "old",
    fingerprintKind: "git_sha",
  });
  stampPluginOrigin(high.id, {
    locator: "demo@mkt",
    fingerprint: "old",
    fingerprintKind: "git_sha",
  });
  const report = await checkPluginOrigins({
    deps: {
      refreshMarketplace: async () => ({ ok: false, message: "clone failed" }),
      refreshGit: async () => ({ ok: true, sha: "x", message: "ok" }),
      listCatalogLatest: async () => ({ version: "1.0.0" }),
    },
  });
  expect(report.results).toHaveLength(2);
  expect(report.results.every((r) => r.status === "error")).toBe(true);
  expect(report.results.every((r) => r.message === "clone failed")).toBe(true);
});

it("turns a rejected marketplace refresh into error rows instead of throwing", async () => {
  createUpstream("demo", "demo@mkt", "aaa");
  const report = await checkPluginOrigins({
    deps: {
      refreshMarketplace: async () => {
        throw new Error("network down");
      },
      refreshGit: async () => ({ ok: true, sha: "x", message: "ok" }),
      listCatalogLatest: async () => ({ version: "1.0.0" }),
    },
  });
  expect(report.results.length).toBeGreaterThan(0);
  expect(report.results.every((r) => r.status === "error")).toBe(true);
  expect(report.results[0]?.message).toBe("network down");
});
