import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb } from "../../src/db/connection.ts";
import { addResourceToPlugin, createPlugin, getPluginById } from "../../src/models/plugin-model.ts";
import type { Plugin } from "../../src/types.ts";
import { createResource } from "../../src/models/resource.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import {
  ExtendsError,
  assertNoExtendsCycle,
  listComposedItems,
  listPluginExcludes,
  resolveUpstreamParent,
  setPluginExcludes,
} from "../../src/services/plugin-extends.ts";
import { setPluginUpstream } from "../../src/services/plugin-upstream.ts";
import { cutPluginVersion } from "../../src/services/plugin-versioning.ts";
import { resolveComposition } from "../../src/services/resolve/index.ts";
import { mergePluginsForApply } from "../../src/services/plugin-apply-merge.ts";
import { collectProfilePluginIds } from "../../src/services/profile-apply.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("plugin-extends-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function skill(pluginId: string, name: string, content = name): void {
  const resource = createResource({
    type: "skill",
    name,
    description: "",
    content,
    metadata: {},
    source: "test",
    namespace: `${pluginId}-${content}`,
  });
  addResourceToPlugin(pluginId, resource.id);
}

function catalogParent(version = "1.0.0"): Plugin {
  return createPlugin({
    name: "backend-engineer",
    version,
    org_slug: "acme",
    catalog_slug: "default",
    origin: "catalog",
  });
}

function extendsChild(name = "backend-qa", ref = "acme/default/backend-engineer@^1.0.0"): Plugin {
  const child = createPlugin({ name, version: "1.0.0" });
  setPluginUpstream(child.id, { kind: "extends", ref, version_at_link: "1.0.0" });
  return getPluginById(child.id)!;
}

function resolvedSkills(name: string): string[] {
  return resolveComposition({ rootSelectors: [name] })
    .resources.filter((resource) => resource.type === "skill")
    .map((resource) => `${resource.name}=${resource.content}`)
    .sort();
}

describe("extends composition", () => {
  it("shows the parent's items live, minus hidden ones, plus its own", () => {
    const parent = catalogParent();
    skill(parent.id, "review");
    skill(parent.id, "deploy");
    const child = extendsChild();
    skill(child.id, "qa-checklist");

    expect(resolvedSkills("backend-qa")).toEqual(["deploy=deploy", "qa-checklist=qa-checklist", "review=review"]);

    setPluginExcludes(child.id, ["skill:deploy"]);
    expect(resolvedSkills("backend-qa")).toEqual(["qa-checklist=qa-checklist", "review=review"]);

    // A parent edit reaches the child with no copy step.
    skill(parent.id, "incident");
    expect(resolvedSkills("backend-qa")).toContain("incident=incident");

    expect(
      listComposedItems(child.id).map((item) => `${item.source}:${item.resource.name}`),
    ).toEqual(["parent:review", "parent:incident", "own:qa-checklist"]);
  });

  it("applies the composed set through the profile merge path", () => {
    const parent = catalogParent();
    skill(parent.id, "review");
    skill(parent.id, "deploy");
    createPlugin({ name: "feature-dev", version: "1.0.0" });
    addDependency(parent.id, "feature-dev");
    const child = extendsChild();
    skill(child.id, "qa-checklist");
    setPluginExcludes(child.id, ["skill:deploy"]);

    const ids = collectProfilePluginIds(getPluginById(child.id)!);
    expect(ids.map((id) => getPluginById(id)?.name)).toEqual(["backend-qa", "feature-dev"]);
    expect(
      mergePluginsForApply(ids)
        .resources.filter((resource) => resource.type === "skill")
        .map((resource) => resource.name)
        .sort(),
    ).toEqual(["qa-checklist", "review"]);
  });

  it("lets the child win on a name clash", () => {
    const parent = catalogParent();
    skill(parent.id, "review", "parent text");
    const child = extendsChild();
    skill(child.id, "review", "child text");
    expect(resolvedSkills("backend-qa")).toEqual(["review=child text"]);
  });

  it("inherits dependencies and can hide one", async () => {
    const parent = catalogParent();
    createPlugin({ name: "feature-dev", version: "1.0.0" });
    createPlugin({ name: "web-search", version: "1.0.0" });
    addDependency(parent.id, "feature-dev");
    addDependency(parent.id, "web-search");
    const child = extendsChild();

    const names = () =>
      resolveComposition({ rootSelectors: ["backend-qa"] })
        .selected.filter((entry) => entry.depth > 0)
        .map((entry) => entry.name)
        .sort();
    expect(names()).toEqual(["feature-dev", "web-search"]);
    setPluginExcludes(child.id, ["plugin:web-search"]);
    expect(names()).toEqual(["feature-dev"]);
  });

  it("follows the newest parent inside the range and never a new major", () => {
    catalogParent("1.0.0");
    catalogParent("1.2.0");
    catalogParent("2.0.0");
    const child = extendsChild();
    expect(resolveUpstreamParent(child)?.version).toBe("1.2.0");
  });

  it("finds a pulled parent stored under its display name by its catalog locator", () => {
    const pulled = createPlugin({
      name: "Backend engineer",
      version: "1.0.0",
      org_slug: "acme",
      catalog_slug: "default",
      origin: "catalog",
    });
    getDb()
      .prepare("UPDATE plugins SET origin_locator = 'acme/default/backend-engineer' WHERE id = ?")
      .run(pulled.id);
    const child = extendsChild();
    expect(resolveUpstreamParent(child)?.id).toBe(pulled.id);
  });

  it("refuses to resolve when the parent is not installed and names the pull command", () => {
    extendsChild();
    try {
      resolveComposition({ rootSelectors: ["backend-qa"] });
      throw new Error("expected a missing parent error");
    } catch (error) {
      expect(error).toBeInstanceOf(ExtendsError);
      expect((error as ExtendsError).code).toBe("parent_missing");
      expect((error as Error).message).toBe(
        "Parent acme/default/backend-engineer@^1.0.0 of backend-qa is not installed. " +
          "Run `ht profile pull acme/default/backend-engineer@1.0.0` first.",
      );
    }
  });

  it("refuses a cycle, direct or through a parent", () => {
    const a = createPlugin({ name: "a", version: "1.0.0" });
    const b = createPlugin({ name: "b", version: "1.0.0" });
    setPluginUpstream(b.id, { kind: "extends", ref: "a@^1.0.0", version_at_link: "1.0.0" });

    expect(() =>
      assertNoExtendsCycle(getPluginById(a.id)!, { kind: "extends", ref: "a@^1.0.0", version_at_link: "1.0.0" }),
    ).toThrow("a cannot extend itself (a@^1.0.0).");
    expect(() =>
      assertNoExtendsCycle(getPluginById(a.id)!, { kind: "extends", ref: "b@^1.0.0", version_at_link: "1.0.0" }),
    ).toThrow("a > b > a is a cycle");
    // A fork link is a copy, never a cycle.
    expect(() =>
      assertNoExtendsCycle(getPluginById(a.id)!, { kind: "fork", ref: "b@^1.0.0", version_at_link: "1.0.0" }),
    ).not.toThrow();
  });

  it("validates hidden entries against the resource types and only on extends", () => {
    catalogParent();
    const child = extendsChild();
    expect(() => setPluginExcludes(child.id, ["widget:x"])).toThrow('Invalid hidden item "widget:x"');
    expect(setPluginExcludes(child.id, ["plugin:web-search", "skill:review", "skill:review"])).toEqual([
      "plugin:web-search",
      "skill:review",
    ]);

    const fork = createPlugin({ name: "fork", version: "1.0.0" });
    setPluginUpstream(fork.id, { kind: "fork", ref: "acme/default/backend-engineer@^1.0.0", version_at_link: "1.0.0" });
    expect(() => setPluginExcludes(fork.id, ["skill:review"])).toThrow("has nothing to hide");
  });

  it("freezes the hidden list with each cut version", () => {
    catalogParent();
    const child = extendsChild();
    setPluginExcludes(child.id, ["skill:deploy"]);
    cutPluginVersion({ pluginId: child.id, newVersion: "1.1.0" });
    setPluginExcludes(child.id, ["skill:deploy", "skill:review"]);
    cutPluginVersion({ pluginId: child.id, newVersion: "1.2.0" });

    const frozen = (version: string) =>
      (
        getDb()
          .prepare("SELECT id FROM plugins WHERE name = 'backend-qa' AND version = ? AND frozen_at IS NOT NULL")
          .get(version) as { id: string }
      ).id;
    expect(listPluginExcludes(frozen("1.0.0"))).toEqual([]);
    expect(listPluginExcludes(frozen("1.1.0"))).toEqual(["skill:deploy"]);
    expect(listPluginExcludes(child.id)).toEqual(["skill:deploy", "skill:review"]);
    expect(getPluginById(frozen("1.1.0"))?.upstream?.kind).toBe("extends");
  });
});
