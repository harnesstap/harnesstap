import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import {
  createLayer,
  getLayerById,
  listLayerVersions,
} from "../../src/models/plugin-model.ts";
import {
  getLayerOverrides,
  setLayerVersionOverride,
  setLayerResourceOverride,
} from "../../src/services/layer-overrides.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("overrides-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("layer overrides", () => {
  it("defaults to an empty override set", () => {
    const layer = createLayer({ name: "root" });
    expect(getLayerOverrides(layer.id)).toEqual({ versions: {}, resources: {} });
  });

  it("round-trips version and resource overrides", () => {
    const layer = createLayer({ name: "root" });
    setLayerVersionOverride(layer.id, "base", "2.1.0");
    setLayerResourceOverride(layer.id, "instruction:context", "team-standards");
    expect(getLayerOverrides(layer.id)).toEqual({
      versions: { base: "2.1.0" },
      resources: { "instruction:context": "team-standards" },
    });
  });

  it("exposes overrides on the layer model via getLayerById", () => {
    const layer = createLayer({ name: "root" });
    setLayerVersionOverride(layer.id, "base", "2.1.0");
    expect(getLayerById(layer.id)?.overrides).toEqual({
      versions: { base: "2.1.0" },
      resources: {},
    });
  });
});

describe("listLayerVersions", () => {
  it("returns every locally available version for a name, newest first", () => {
    createLayer({ name: "base", version: "1.0.0" });
    createLayer({ name: "base", version: "2.1.0" });
    createLayer({ name: "base", version: "2.0.0" });
    expect(listLayerVersions("base")).toEqual(["2.1.0", "2.0.0", "1.0.0"]);
  });

  it("returns an empty array for an unknown name", () => {
    expect(listLayerVersions("nope")).toEqual([]);
  });
});
