import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import {
  addDependency,
  dependenciesFromResources,
  listDependencies,
  parseDependencyRef,
  removeDependency,
} from "../../src/services/plugin-dependency.ts";
import { makeResource } from "../helpers/resources.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("dep-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("parseDependencyRef", () => {
  it("classifies a bare name as local", () => {
    expect(parseDependencyRef("base")).toEqual({
      name: "base",
      source_kind: "local",
      origin_ref: "base",
      namespace: "",
    });
  });

  it("classifies a relative path as local", () => {
    expect(parseDependencyRef("./vendor/base")).toEqual({
      name: "base",
      source_kind: "local",
      origin_ref: "./vendor/base",
      namespace: "",
    });
  });

  it("classifies name@marketplace as marketplace", () => {
    expect(parseDependencyRef("web-search@anthropics")).toEqual({
      name: "web-search",
      source_kind: "marketplace",
      origin_ref: "web-search@anthropics",
      namespace: "anthropics",
    });
  });

  it("classifies a git URL as git", () => {
    expect(parseDependencyRef("https://github.com/acme/plugin.git")).toEqual({
      name: "plugin",
      source_kind: "git",
      origin_ref: "https://github.com/acme/plugin.git",
      namespace: "",
    });
    expect(parseDependencyRef("git@github.com:acme/plugin.git").source_kind).toBe("git");
  });

  it("classifies org/catalog/name as catalog", () => {
    expect(parseDependencyRef("acme/default/base")).toEqual({
      name: "base",
      source_kind: "catalog",
      origin_ref: "acme/default/base",
      namespace: "acme/default",
    });
  });
});

describe("dependency attachment", () => {
  it("adds, lists, and removes a dependency with its constraint and source", () => {
    const root = createPlugin({ name: "root" });
    addDependency(root.id, "web-search@anthropics", { versionConstraint: "^1.2.0" });
    addDependency(root.id, "base", { versionConstraint: "^2.0.0" });

    const deps = listDependencies(root.id);
    expect(deps).toHaveLength(2);
    expect(deps[0]).toMatchObject({
      name: "web-search",
      source_kind: "marketplace",
      version_constraint: "^1.2.0",
    });
    expect(deps[1]).toMatchObject({
      name: "base",
      source_kind: "local",
      version_constraint: "^2.0.0",
    });

    expect(removeDependency(root.id, "base")).toBe(true);
    expect(listDependencies(root.id).map((d) => d.name)).toEqual(["web-search"]);
  });

  it("preserves declaration order", () => {
    const root = createPlugin({ name: "root" });
    addDependency(root.id, "a");
    addDependency(root.id, "b");
    addDependency(root.id, "c");
    expect(listDependencies(root.id).map((d) => d.name)).toEqual(["a", "b", "c"]);
  });
});

describe("dependenciesFromResources", () => {
  it("maps plugin resources from an already-loaded list and ignores other types", () => {
    const pinned = makeResource({
      type: "plugin",
      name: "formatter",
      origin_ref: "formatter@acme",
      metadata: {
        source_kind: "marketplace",
        version_constraint: "^1.0.0",
      },
    });
    const skill = makeResource({
      id: "resource-2",
      type: "skill",
      name: "alpha",
    });
    expect(dependenciesFromResources([skill, pinned])).toEqual([
      {
        name: "formatter",
        source_kind: "marketplace",
        ref: "formatter@acme",
        version_constraint: "^1.0.0",
        embed_on_export: false,
        resource: pinned,
      },
    ]);
  });
});
