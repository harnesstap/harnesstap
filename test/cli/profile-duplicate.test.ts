import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
  getPluginResources,
  listPlugins,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import {
  UpstreamUnpublishedError,
  listPluginExcludes,
  upstreamUnpublishedFromCloud,
} from "../../src/services/plugin-extends.ts";
import { publishPluginToCatalogs } from "../../src/services/plugin-publish.ts";
import { resolveComposition } from "../../src/services/resolve/index.ts";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("profile-duplicate-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function skill(pluginId: string, name: string): void {
  addResourceToPlugin(
    pluginId,
    createResource({ type: "skill", name, description: `${name} skill`, content: name, metadata: {}, source: "test" }).id,
  );
}

function seedParent(): void {
  const parent = createPlugin({ name: "backend", version: "1.0.0", tags: ["profile"] });
  skill(parent.id, "review");
  skill(parent.id, "deploy");
  createPlugin({ name: "web-search", version: "1.0.0" });
  addDependency(parent.id, "web-search");
}

function resolvedNames(name: string): string[] {
  const resolution = resolveComposition({ rootSelectors: [name] });
  return [
    ...resolution.resources.map((resource) => `${resource.type}:${resource.name}`),
    ...resolution.selected.filter((entry) => entry.depth > 0).map((entry) => `plugin:${entry.name}`),
  ].sort();
}

function output(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}\n${result.stderr}`;
}

describe("profile duplicate", () => {
  it("keeps in sync by default: an empty child with an extends link", async () => {
    seedParent();
    const result = await runCli(["profile", "duplicate", "backend", "backend-qa", "--format", "json"]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      name: "backend-qa",
      version: "1.0.0",
      mode: "inherit",
      linked_to: "backend@1.0.0",
      upstream: { kind: "extends", ref: "backend@^1.0.0", version_at_link: "1.0.0" },
    });
    const child = getPluginByName("backend-qa");
    expect(child?.tags).toContain("profile");
    expect(getPluginResources(child!.id)).toHaveLength(0);
    expect(resolvedNames("backend-qa")).toEqual(["plugin:web-search", "skill:deploy", "skill:review"]);
  });

  it("makes a separate copy with --copy, also from an authored profile", async () => {
    seedParent();
    const result = await runCli(["profile", "duplicate", "backend", "--copy", "--format", "json"]);
    expect(result.exitCode ?? 0).toBe(0);
    const body = JSON.parse(result.stdout) as { name: string; upstream: { kind: string } };
    expect(body.name).toBe("backend-copy");
    expect(body.upstream.kind).toBe("fork");
    expect(getPluginResources(getPluginByName("backend-copy")!.id).map((r) => r.name).sort()).toEqual([
      "deploy",
      "review",
      "web-search",
    ]);
  });

  it("refuses an existing name and leaves the Library unchanged", async () => {
    seedParent();
    createPlugin({ name: "backend-qa", version: "1.0.0" });
    const before = listPlugins().length;
    const result = await runCli(["profile", "duplicate", "backend", "backend-qa"]);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("Plugin backend-qa already exists.");
    expect(listPlugins()).toHaveLength(before);
  });
});

describe("hide and unhide inherited items", () => {
  it("hides and unhides with plugin edit, validating the entries", async () => {
    seedParent();
    await runCli(["profile", "duplicate", "backend", "backend-qa"]);

    const hide = await runCli(["plugin", "edit", "backend-qa", "--hide", "skill:deploy", "--hide", "plugin:web-search"]);
    expect(hide.exitCode ?? 0).toBe(0);
    expect(resolvedNames("backend-qa")).toEqual(["skill:review"]);

    const show = await runCli(["plugin", "show", "backend-qa"]);
    expect(show.stdout).toContain("Extends");
    expect(show.stdout).toContain("Hidden                plugin:web-search, skill:deploy");
    expect(show.stdout).toContain("Inherited             1 item from the parent");

    await runCli(["plugin", "edit", "backend-qa", "--unhide", "plugin:web-search"]);
    expect(listPluginExcludes(getPluginByName("backend-qa")!.id)).toEqual(["skill:deploy"]);

    const bad = await runCli(["plugin", "edit", "backend-qa", "--hide", "widget:x"]);
    expect(bad.exitCode).toBe(1);
    expect(output(bad)).toContain('Invalid hidden item "widget:x"');
  });

  it("refuses to hide on a profile that does not keep in sync", async () => {
    seedParent();
    const result = await runCli(["plugin", "edit", "backend", "--hide", "skill:review"]);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("backend does not keep in sync with a parent");
  });
});

describe("profile detach", () => {
  it("makes the effective set its own, keeps the link as a fork, and deletes nothing", async () => {
    seedParent();
    await runCli(["profile", "duplicate", "backend", "backend-qa"]);
    const child = getPluginByName("backend-qa")!;
    skill(child.id, "qa-checklist");
    await runCli(["plugin", "edit", "backend-qa", "--hide", "skill:deploy"]);
    const resolvedBefore = resolvedNames("backend-qa");

    const result = await runCli(["profile", "detach", "backend-qa", "--format", "json"]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      name: "backend-qa",
      upstream: { kind: "fork", ref: "backend@^1.0.0", version_at_link: "1.0.0" },
      materialized: 2,
      hidden_cleared: ["skill:deploy"],
    });

    expect(resolvedNames("backend-qa")).toEqual(resolvedBefore);
    expect(getPluginResources(child.id).map((r) => r.name).sort()).toEqual(["qa-checklist", "review", "web-search"]);
    expect(listPluginExcludes(child.id)).toEqual([]);
    // The parent is untouched.
    expect(getPluginResources(getPluginByName("backend")!.id).map((r) => r.name).sort()).toEqual([
      "deploy",
      "review",
      "web-search",
    ]);
  });

  it("refuses a profile that is not kept in sync", async () => {
    seedParent();
    const result = await runCli(["profile", "detach", "backend"]);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("there is nothing to detach");
  });
});

describe("publish parent gate", () => {
  it("refuses a keep-in-sync child of an unpublished parent before any cut or network call", async () => {
    seedParent();
    await runCli(["profile", "duplicate", "backend", "backend-qa"]);
    const result = await runCli([
      "plugin",
      "publish",
      "backend-qa",
      "--org",
      "acme",
      "--catalog",
      "team",
      "--version",
      "1.1.0",
    ]);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain(
      "backend-qa keeps in sync with backend@^1.0.0, which is not published. Publish the parent first, or detach this profile to publish it as a separate copy.",
    );
    expect(output(result)).toContain("ht profile detach backend-qa");
    // No version was cut.
    expect(listPlugins().filter((plugin) => plugin.name === "backend-qa").map((p) => p.version)).toEqual(["1.0.0"]);
  });

  it("guards the shared publish path too", async () => {
    seedParent();
    await runCli(["profile", "duplicate", "backend", "backend-qa"]);
    const child = getPluginByName("backend-qa")!;
    await expect(
      publishPluginToCatalogs({ ...child, dirty: false }, [{ org: "acme", catalog: "team" } as never]),
    ).rejects.toBeInstanceOf(UpstreamUnpublishedError);
  });

  it("lets a child publish once its parent lives in a catalog", async () => {
    const parent = createPlugin({ name: "backend", version: "1.0.0", org_slug: "acme", catalog_slug: "team" });
    skill(parent.id, "review");
    await runCli(["profile", "duplicate", "backend", "backend-qa"]);
    const result = await runCli(["plugin", "publish", "backend-qa", "--org", "acme", "--catalog", "team"]);
    expect(output(result)).not.toContain("which is not published");
  });

  it("maps Cloud's 400 upstream_unpublished onto the same message", () => {
    seedParent();
    const child = createPlugin({ name: "backend-qa", version: "1.0.0" });
    const mapped = upstreamUnpublishedFromCloud(
      { ...child, upstream: { kind: "extends", ref: "acme/team/backend@^1.0.0", version_at_link: "1.0.0" } },
      'HTTP 400: {"error":"upstream_unpublished","ref":"acme/team/backend@^1.0.0"}',
    );
    expect(mapped?.message).toBe(
      "backend-qa keeps in sync with acme/team/backend@^1.0.0, which is not published. Publish the parent first, or detach this profile to publish it as a separate copy.",
    );
  });
});
