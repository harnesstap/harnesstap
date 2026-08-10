import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { createPlugin, getPluginById } from "../../src/models/plugin-model.ts";
import {
  PluginProvenanceError,
  assertAuthored,
  assertSyncable,
  getPluginOrigin,
  setPluginOrigin,
} from "../../src/services/plugin-origin.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("origin-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("plugin origin", () => {
  it("defaults new plugins to authored", () => {
    const plugin = createPlugin({ name: "mine" });
    expect(getPluginOrigin(plugin.id)).toBe("authored");
    expect(getPluginById(plugin.id)?.origin).toBe("authored");
  });

  it("round-trips an upstream origin", () => {
    const plugin = createPlugin({ name: "web-search" });
    setPluginOrigin(plugin.id, "upstream");
    expect(getPluginOrigin(plugin.id)).toBe("upstream");
  });

  it("refuses to edit an upstream plugin and names fork as the fix", () => {
    const plugin = createPlugin({ name: "web-search" });
    setPluginOrigin(plugin.id, "upstream");
    let caught: unknown;
    try {
      assertAuthored(plugin.id, "edit");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PluginProvenanceError);
    const error = caught as PluginProvenanceError;
    expect(error.message).toBe(
      "web-search is an upstream plugin and cannot be edited directly",
    );
    expect(error.hints).toEqual(["ht plugin fork web-search"]);
  });

  it("refuses to publish a catalog plugin", () => {
    const plugin = createPlugin({ name: "acme-base" });
    setPluginOrigin(plugin.id, "catalog");
    expect(() => assertAuthored(plugin.id, "publish")).toThrow(
      "acme-base is a catalog plugin and cannot be published directly",
    );
  });

  it("allows every capability on an authored plugin", () => {
    const plugin = createPlugin({ name: "mine" });
    expect(() => assertAuthored(plugin.id, "edit")).not.toThrow();
    expect(() => assertAuthored(plugin.id, "cut")).not.toThrow();
    expect(() => assertAuthored(plugin.id, "publish")).not.toThrow();
    expect(() => assertAuthored(plugin.id, "needs")).not.toThrow();
  });

  it("refuses to sync an authored plugin", () => {
    const plugin = createPlugin({ name: "mine" });
    expect(() => assertSyncable(plugin.id)).toThrow(
      "mine is an authored plugin; there is no upstream to sync from",
    );
  });

  it("allows sync on upstream and catalog plugins", () => {
    const upstream = createPlugin({ name: "web-search" });
    setPluginOrigin(upstream.id, "upstream");
    const catalog = createPlugin({ name: "acme-base" });
    setPluginOrigin(catalog.id, "catalog");
    expect(() => assertSyncable(upstream.id)).not.toThrow();
    expect(() => assertSyncable(catalog.id)).not.toThrow();
  });
});
