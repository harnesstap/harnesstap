import { expect, it, beforeEach, afterEach } from "bun:test";
import { createPlugin, getPluginById } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { addResourceToPlugin } from "../../src/models/plugin-model.ts";
import { setPluginOrigin } from "../../src/services/plugin-origin.ts";
import { cutPluginVersion } from "../../src/services/plugin-versioning.ts";
import {
  formatOriginLocator,
  parseOriginLocator,
  recoverOriginLocator,
  selectOriginUpdateTarget,
  listOriginUpdateCandidates,
} from "../../src/services/plugin-origin-locator.ts";
import { stampPluginOrigin, bumpPluginWorkingVersion } from "../../src/models/plugin-model.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("origin-locator-");
});
afterEach(async () => {
  await ctx.cleanup();
});

it("formats and parses marketplace, git, and catalog locators", () => {
  expect(formatOriginLocator({ kind: "marketplace", ref: "web-search@anthropics" })).toBe(
    "web-search@anthropics",
  );
  expect(parseOriginLocator("web-search@anthropics")).toEqual({
    kind: "marketplace",
    ref: "web-search@anthropics",
  });
  expect(formatOriginLocator({ kind: "git", url: "https://github.com/acme/pack.git" })).toBe(
    "https://github.com/acme/pack.git",
  );
  expect(parseOriginLocator("https://github.com/acme/pack.git")).toEqual({
    kind: "git",
    url: "https://github.com/acme/pack.git",
  });
  expect(parseOriginLocator("git@github.com:acme/pack.git")).toEqual({
    kind: "git",
    url: "git@github.com:acme/pack.git",
  });
  expect(formatOriginLocator({ kind: "catalog", org: "acme", catalog: "default", slug: "foundation" })).toBe(
    "acme/default/foundation",
  );
  expect(parseOriginLocator("acme/default/foundation")).toEqual({
    kind: "catalog",
    org: "acme",
    catalog: "default",
    slug: "foundation",
  });
  expect(parseOriginLocator("bare-name")).toBeNull();
});

it("recovers marketplace locator from marketplace_link origin_ref", () => {
  const plugin = createPlugin({ name: "web-search", version: "1.0.0", origin: "upstream" });
  setPluginOrigin(plugin.id, "upstream");
  const resource = createResource({
    type: "skill",
    name: "hello",
    description: "",
    content: "# hi",
    metadata: {},
    source: "marketplace",
    origin_kind: "marketplace_link",
    origin_ref: "web-search@anthropics",
  });
  addResourceToPlugin(plugin.id, resource.id);
  expect(formatOriginLocator(recoverOriginLocator(getPluginById(plugin.id)!)!)).toBe(
    "web-search@anthropics",
  );
});

it("recovers catalog locator from org/catalog even when local name differs", () => {
  const plugin = createPlugin({
    name: "local-foundation",
    version: "1.0.0",
    origin: "catalog",
    org_slug: "acme",
    catalog_slug: "default",
  });
  setPluginOrigin(plugin.id, "catalog");
  stampPluginOrigin(plugin.id, { locator: "acme/default/foundation" });
  expect(formatOriginLocator(recoverOriginLocator(getPluginById(plugin.id)!)!)).toBe(
    "acme/default/foundation",
  );
});

it("authored and frozen plugins are not update candidates", () => {
  createPlugin({ name: "mine", version: "1.0.0" });
  const frozen = createPlugin({ name: "up", version: "1.0.0", origin: "upstream" });
  setPluginOrigin(frozen.id, "upstream");
  cutPluginVersion({ pluginId: frozen.id, newVersion: "1.1.0" });
  expect(listOriginUpdateCandidates().map((p) => p.name)).not.toContain("mine");
  const frozenRow = listOriginUpdateCandidates().find((p) => p.name === "up" && p.version === "1.0.0");
  expect(frozenRow).toBeUndefined();
});

it("duplicate locator keeps the highest version as the target", () => {
  const low = createPlugin({ name: "demo", version: "1.0.0", origin: "upstream" });
  const high = createPlugin({ name: "demo", version: "1.2.0", origin: "upstream" });
  setPluginOrigin(low.id, "upstream");
  setPluginOrigin(high.id, "upstream");
  stampPluginOrigin(low.id, { locator: "demo@mkt" });
  stampPluginOrigin(high.id, { locator: "demo@mkt" });
  const groups = selectOriginUpdateTarget(listOriginUpdateCandidates());
  const group = groups.find((g) => formatOriginLocator(recoverOriginLocator(g.target)!) === "demo@mkt");
  expect(group?.target.version).toBe("1.2.0");
  expect(group?.skipped.map((p) => p.version)).toContain("1.0.0");
});

it("locator-only stampPluginOrigin leaves an existing fingerprint unchanged", () => {
  const plugin = createPlugin({ name: "web-search", version: "1.0.0", origin: "upstream" });
  stampPluginOrigin(plugin.id, {
    locator: "web-search@anthropics",
    fingerprint: "abc123",
    fingerprintKind: "git_sha",
  });
  stampPluginOrigin(plugin.id, { locator: "web-search@other" });
  const stamped = getPluginById(plugin.id);
  expect(stamped?.origin_locator).toBe("web-search@other");
  expect(stamped?.origin_fingerprint).toBe("abc123");
  expect(stamped?.origin_fingerprint_kind).toBe("git_sha");
});

it("bumpPluginWorkingVersion refuses a version that already exists as a frozen cut", () => {
  const head = createPlugin({ name: "pack", version: "1.0.0", origin: "upstream" });
  setPluginOrigin(head.id, "upstream");
  cutPluginVersion({ pluginId: head.id, newVersion: "1.2.0" });
  // After cut, working head is 1.2.0; frozen sibling pack@1.0.0 shares UNIQUE(org, catalog, name, version).
  expect(() => bumpPluginWorkingVersion(head.id, "1.0.0")).toThrow(/frozen/);
});
