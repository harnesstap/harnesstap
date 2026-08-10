import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { createLayer, getLayerById } from "../../src/models/plugin-model.ts";
import {
  LayerProvenanceError,
  assertAuthored,
  assertSyncable,
  getLayerOrigin,
  setLayerOrigin,
} from "../../src/services/layer-origin.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("origin-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("layer origin", () => {
  it("defaults new layers to authored", () => {
    const layer = createLayer({ name: "mine" });
    expect(getLayerOrigin(layer.id)).toBe("authored");
    expect(getLayerById(layer.id)?.origin).toBe("authored");
  });

  it("round-trips an upstream origin", () => {
    const layer = createLayer({ name: "web-search" });
    setLayerOrigin(layer.id, "upstream");
    expect(getLayerOrigin(layer.id)).toBe("upstream");
  });

  it("refuses to edit an upstream layer and names fork as the fix", () => {
    const layer = createLayer({ name: "web-search" });
    setLayerOrigin(layer.id, "upstream");
    let caught: unknown;
    try {
      assertAuthored(layer.id, "edit");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LayerProvenanceError);
    const error = caught as LayerProvenanceError;
    expect(error.message).toBe(
      "web-search is an upstream plugin and cannot be edited directly",
    );
    expect(error.hints).toEqual(["ht layer fork web-search"]);
  });

  it("refuses to publish a catalog layer", () => {
    const layer = createLayer({ name: "acme-base" });
    setLayerOrigin(layer.id, "catalog");
    expect(() => assertAuthored(layer.id, "publish")).toThrow(
      "acme-base is a catalog plugin and cannot be published directly",
    );
  });

  it("allows every capability on an authored layer", () => {
    const layer = createLayer({ name: "mine" });
    expect(() => assertAuthored(layer.id, "edit")).not.toThrow();
    expect(() => assertAuthored(layer.id, "cut")).not.toThrow();
    expect(() => assertAuthored(layer.id, "publish")).not.toThrow();
    expect(() => assertAuthored(layer.id, "needs")).not.toThrow();
  });

  it("refuses to sync an authored layer", () => {
    const layer = createLayer({ name: "mine" });
    expect(() => assertSyncable(layer.id)).toThrow(
      "mine is an authored plugin; there is no upstream to sync from",
    );
  });

  it("allows sync on upstream and catalog layers", () => {
    const upstream = createLayer({ name: "web-search" });
    setLayerOrigin(upstream.id, "upstream");
    const catalog = createLayer({ name: "acme-base" });
    setLayerOrigin(catalog.id, "catalog");
    expect(() => assertSyncable(upstream.id)).not.toThrow();
    expect(() => assertSyncable(catalog.id)).not.toThrow();
  });
});
