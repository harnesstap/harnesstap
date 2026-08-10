import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { createLayer, getLayerByName } from "../../src/models/layer-model.ts";
import { getLayerOverrides } from "../../src/services/layer-overrides.ts";
import { listAttachedLayerRefs } from "../../src/services/layer-composition.ts";
import { scaffoldCompositionLayer } from "../../src/services/resolve-conflict-scaffold.ts";
import { SingletonConflictError } from "../../src/services/resolve/types.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("scaffold-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("scaffoldCompositionLayer", () => {
  it("creates a real layer whose dependencies are the attempted composition", async () => {
    createLayer({ name: "a", version: "1.0.0" });
    createLayer({ name: "b", version: "1.0.0" });

    const created = await scaffoldCompositionLayer({
      name: "my-setup",
      dependencies: ["a", "b"],
      resourceOverrides: { "instruction:context": "b" },
      versionOverrides: {},
    });

    const layer = getLayerByName("my-setup");
    expect(layer?.id).toBe(created.id);
    expect(
      listAttachedLayerRefs(created.id).map((ref) => ref.dependency_name).sort(),
    ).toEqual(["a", "b"]);
    expect(getLayerOverrides(created.id).resources).toEqual({
      "instruction:context": "b",
    });
  });

  it("derives override choices from a singleton conflict", () => {
    const error = new SingletonConflictError({
      key: "instruction:context",
      sides: [
        { layerName: "a", layerVersion: "1.0.0", depth: 1 },
        { layerName: "b", layerVersion: "1.0.0", depth: 1 },
      ],
      rootName: "my-setup",
    });
    expect(error.hints).toEqual([
      "ht layer edit my-setup --override instruction:context=a",
      "ht layer edit my-setup --override instruction:context=b",
    ]);
  });

  it("refuses to overwrite an existing layer name", async () => {
    createLayer({ name: "a", version: "1.0.0" });
    createLayer({ name: "taken", version: "1.0.0" });
    await expect(
      scaffoldCompositionLayer({
        name: "taken",
        dependencies: ["a"],
        resourceOverrides: {},
        versionOverrides: {},
      }),
    ).rejects.toThrow(/already exists/);
  });
});
