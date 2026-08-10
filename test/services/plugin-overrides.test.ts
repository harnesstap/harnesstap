import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import {
  createPlugin,
  getPluginById,
  listPluginVersions,
} from "../../src/models/plugin-model.ts";
import {
  getPluginOverrides,
  setPluginVersionOverride,
  setPluginResourceOverride,
} from "../../src/services/plugin-overrides.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("overrides-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("plugin overrides", () => {
  it("defaults to an empty override set", () => {
    const plugin = createPlugin({ name: "root" });
    expect(getPluginOverrides(plugin.id)).toEqual({ versions: {}, resources: {} });
  });

  it("round-trips version and resource overrides", () => {
    const plugin = createPlugin({ name: "root" });
    setPluginVersionOverride(plugin.id, "base", "2.1.0");
    setPluginResourceOverride(plugin.id, "instruction:context", "team-standards");
    expect(getPluginOverrides(plugin.id)).toEqual({
      versions: { base: "2.1.0" },
      resources: { "instruction:context": "team-standards" },
    });
  });

  it("exposes overrides on the plugin model via getPluginById", () => {
    const plugin = createPlugin({ name: "root" });
    setPluginVersionOverride(plugin.id, "base", "2.1.0");
    expect(getPluginById(plugin.id)?.overrides).toEqual({
      versions: { base: "2.1.0" },
      resources: {},
    });
  });
});

describe("listPluginVersions", () => {
  it("returns every locally available version for a name, newest first", () => {
    createPlugin({ name: "base", version: "1.0.0" });
    createPlugin({ name: "base", version: "2.1.0" });
    createPlugin({ name: "base", version: "2.0.0" });
    expect(listPluginVersions("base")).toEqual(["2.1.0", "2.0.0", "1.0.0"]);
  });

  it("returns an empty array for an unknown name", () => {
    expect(listPluginVersions("nope")).toEqual([]);
  });
});
