import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { addResourceToLayer, createLayer, getLayerByName } from "../../src/models/plugin-model.ts";
import { ensureLayerResource } from "../../src/services/layer-composition.ts";
import { cutLayerVersion, getFrozenResolvedSet } from "../../src/services/layer-versioning.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("cut-resolved-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("cut freezes the resolved set", () => {
  it("records the exact dependency versions resolved at cut time", () => {
    createLayer({ name: "base", version: "1.0.0" });
    const root = createLayer({ name: "root", version: "1.0.0" });
    // Attach without markLayerDirty so the clean cut freezes this composition
    // (addLayerAttachment dirties first and COW would freeze the pre-attach state).
    const dep = ensureLayerResource("layer:base", { versionConstraint: "^1.0.0" });
    addResourceToLayer(root.id, dep.id);

    cutLayerVersion({ layerId: root.id, newVersion: "1.1.0" });
    createLayer({ name: "base", version: "1.5.0" });

    const frozen = getLayerByName("root", "1.0.0");
    expect(frozen).toBeDefined();
    if (!frozen) return;
    expect(getFrozenResolvedSet(frozen.id)).toEqual([
      { name: "base", version: "1.0.0" },
    ]);
  });

  it("returns an empty set for a layer that was never cut", () => {
    const layer = createLayer({ name: "solo" });
    expect(getFrozenResolvedSet(layer.id)).toEqual([]);
  });
});
