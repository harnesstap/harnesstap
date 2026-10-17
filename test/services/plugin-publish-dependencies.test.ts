import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createPlugin, getPluginById, updatePluginPublishedIdentity } from "../../src/models/plugin-model.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import {
  assertDependenciesPublished,
  listUnpublishedDependencies,
  UnpublishedDependenciesError,
} from "../../src/services/plugin-publish-dependencies.ts";
import { publishPluginToCatalogs } from "../../src/services/plugin-publish.ts";
import { cutPluginVersion } from "../../src/services/plugin-versioning.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("publish-dependencies-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("publish dependency gate", () => {
  it("lists only local dependencies whose plugin is not in a catalog", () => {
    const profile = createPlugin({ name: "backend-qa" });
    createPlugin({ name: "continual-learning" });
    const published = createPlugin({ name: "team-tools" });
    updatePluginPublishedIdentity(published.id, {
      org_slug: "acme",
      catalog_slug: "default",
      version: "1.0.0",
    });
    createPlugin({ name: "embedded-helper" });

    addDependency(profile.id, "continual-learning");
    addDependency(profile.id, "team-tools");
    addDependency(profile.id, "embedded-helper", { embedOnExport: true });
    addDependency(profile.id, "superpowers@cursor-public");
    // Not in this library: nothing to say about it locally.
    addDependency(profile.id, "feature-dev", { versionConstraint: "1.0.0" });

    expect(listUnpublishedDependencies(profile.id)).toEqual(["continual-learning"]);
  });

  it("assertDependenciesPublished throws with the names and a removal hint", () => {
    const profile = createPlugin({ name: "backend-qa" });
    createPlugin({ name: "continual-learning" });
    addDependency(profile.id, "continual-learning");

    let caught: unknown;
    try {
      assertDependenciesPublished(getPluginById(profile.id)!);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnpublishedDependenciesError);
    const error = caught as UnpublishedDependenciesError;
    expect(error.dependencies).toEqual(["continual-learning"]);
    expect(error.message).toBe(
      "Cannot publish backend-qa: it depends on local plugins that are not in a catalog: continual-learning. Publish them first, or remove them with ht plugin edit backend-qa --remove plugin:continual-learning",
    );
  });

  it("publishPluginToCatalogs refuses before contacting any catalog", async () => {
    const profile = createPlugin({ name: "backend-qa" });
    createPlugin({ name: "continual-learning" });
    addDependency(profile.id, "continual-learning");
    const cut = cutPluginVersion({ pluginId: profile.id, newVersion: "1.1.0" });

    await expect(
      publishPluginToCatalogs(cut, [
        { org: "acme", catalog: "default", account: "nobody" },
      ]),
    ).rejects.toBeInstanceOf(UnpublishedDependenciesError);
  });
});
