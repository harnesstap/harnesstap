import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../../helpers/db.ts";
import type { TestContext } from "../../helpers/db.ts";
import {
  addResourceToLayer,
  createLayer,
  getLayerByName,
} from "../../../src/models/layer-model.ts";
import { createResource } from "../../../src/models/resource.ts";
import { addLayerAttachment } from "../../../src/services/layer-composition.ts";
import { resolveComposition } from "../../../src/services/resolve/index.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("compose-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function attachSkill(layerId: string, name: string, content: string, ns: string): void {
  const resource = createResource({
    type: "skill",
    name,
    description: "",
    content,
    metadata: {},
    source: "test",
    namespace: ns,
  });
  addResourceToLayer(layerId, resource.id);
}

describe("resolveComposition", () => {
  it("resolves a single named root", async () => {
    const base = createLayer({ name: "base" });
    const root = createLayer({ name: "root" });
    attachSkill(base.id, "alpha", "BASE", "base");
    const rootLayer = getLayerByName("root");
    if (!rootLayer) throw new Error("missing root");
    await addLayerAttachment({ layer: rootLayer, selector: "layer:base" });

    const result = resolveComposition({ rootSelectors: ["root"] });
    expect(result.root.ephemeral).toBe(false);
    expect(result.root.name).toBe("root");
    expect(result.resources.map((r) => r.name)).toEqual(["alpha"]);
  });

  it("synthesizes an ephemeral root for multiple selectors and keeps last-wins", () => {
    const a = createLayer({ name: "a" });
    const b = createLayer({ name: "b" });
    attachSkill(a.id, "alpha", "FROM-A", "a");
    attachSkill(b.id, "alpha", "FROM-B", "b");

    const result = resolveComposition({ rootSelectors: ["a", "b"] });
    expect(result.root.ephemeral).toBe(true);
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.content).toBe("FROM-B");
  });

  it("cleans up the ephemeral root layer row", () => {
    createLayer({ name: "a" });
    createLayer({ name: "b" });
    const result = resolveComposition({ rootSelectors: ["a", "b"] });
    expect(getLayerByName(result.root.name)).toBeUndefined();
  });

  it("rejects an unknown selector", () => {
    expect(() => resolveComposition({ rootSelectors: ["nope"] })).toThrow(
      /Layer not found: nope/,
    );
  });
});
