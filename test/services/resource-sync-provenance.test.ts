import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { PluginProvenanceError } from "../../src/services/plugin-origin.ts";
import { syncPluginResource } from "../../src/services/resource-sync.ts";
import { listDependencies } from "../../src/services/plugin-dependency.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("sync-prov-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("sync provenance gating", () => {
  it("refuses syncing a local dependency that names an authored plugin", async () => {
    createPlugin({ name: "mine", version: "1.0.0" });
    const root = createPlugin({ name: "root" });
    addDependency(root.id, "mine");
    const dep = listDependencies(root.id)[0];
    if (!dep) throw new Error("expected dependency");

    await expect(syncPluginResource(dep.resource)).rejects.toBeInstanceOf(
      PluginProvenanceError,
    );
    await expect(syncPluginResource(dep.resource)).rejects.toThrow(/authored/);
  });

  it("does not refuse marketplace deps just because a consumer plugin is authored", async () => {
    const root = createPlugin({ name: "mine" });
    addDependency(root.id, "formatter@acme-marketplace", {
      versionConstraint: "1.2.3",
    });
    const dep = listDependencies(root.id)[0];
    if (!dep) throw new Error("expected dependency");

    // No install tree → stale result, but must not throw provenance.
    const result = await syncPluginResource(dep.resource, {
      homeRoot: ctx.homeDir,
    });
    expect(result.stale.length + result.checked).toBeGreaterThan(0);
  });
});
