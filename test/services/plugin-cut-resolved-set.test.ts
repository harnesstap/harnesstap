import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { addResourceToPlugin, createPlugin, getPluginByName } from "../../src/models/plugin-model.ts";
import { ensurePluginResource } from "../../src/services/plugin-composition.ts";
import { cutPluginVersion, getFrozenResolvedSet } from "../../src/services/plugin-versioning.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("cut-resolved-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("cut freezes the resolved set", () => {
  it("records the exact dependency versions resolved at cut time", () => {
    createPlugin({ name: "base", version: "1.0.0" });
    const root = createPlugin({ name: "root", version: "1.0.0" });
    // Attach without markPluginDirty so the clean cut freezes this composition
    // (addPluginAttachment dirties first and COW would freeze the pre-attach state).
    const dep = ensurePluginResource("plugin:base", { versionConstraint: "^1.0.0" });
    addResourceToPlugin(root.id, dep.id);

    cutPluginVersion({ pluginId: root.id, newVersion: "1.1.0" });
    createPlugin({ name: "base", version: "1.5.0" });

    const frozen = getPluginByName("root", "1.0.0");
    expect(frozen).toBeDefined();
    if (!frozen) return;
    expect(getFrozenResolvedSet(frozen.id)).toEqual([
      { name: "base", version: "1.0.0" },
    ]);
  });

  it("returns an empty set for a plugin that was never cut", () => {
    const plugin = createPlugin({ name: "solo" });
    expect(getFrozenResolvedSet(plugin.id)).toEqual([]);
  });
});
