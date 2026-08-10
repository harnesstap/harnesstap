import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { createResource } from "../../src/models/resource.ts";
import { createLayer, getLayerByName, getLayerResources } from "../../src/models/plugin-model.ts";
import { getLayerOrigin } from "../../src/services/layer-origin.ts";
import { materializeUpstreamPluginLayer } from "../../src/services/upstream-plugin-layer.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("upstream-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function linkedSkill(name: string, ref: string): void {
  createResource({
    type: "skill",
    name,
    description: "",
    content: `# ${name}`,
    metadata: {},
    source: "plugin",
    namespace: ref,
    origin_kind: "marketplace_link",
    origin_ref: ref,
  });
}

describe("materializeUpstreamPluginLayer", () => {
  it("groups an install tree's resources into an upstream layer", () => {
    linkedSkill("search", "web-search@anthropics");
    linkedSkill("summarize", "web-search@anthropics");

    const layer = materializeUpstreamPluginLayer({
      ref: "web-search@anthropics",
      name: "web-search",
      version: "1.2.0",
    });

    expect(layer.name).toBe("web-search");
    expect(layer.version).toBe("1.2.0");
    expect(getLayerOrigin(layer.id)).toBe("upstream");
    expect(getLayerResources(layer.id).map((r) => r.name).sort()).toEqual([
      "search",
      "summarize",
    ]);
  });

  it("is idempotent for the same ref and version", () => {
    linkedSkill("search", "web-search@anthropics");
    const first = materializeUpstreamPluginLayer({
      ref: "web-search@anthropics",
      name: "web-search",
      version: "1.2.0",
    });
    const second = materializeUpstreamPluginLayer({
      ref: "web-search@anthropics",
      name: "web-search",
      version: "1.2.0",
    });
    expect(second.id).toBe(first.id);
  });

  it("creates a separate row for a new upstream version", () => {
    linkedSkill("search", "web-search@anthropics");
    const v1 = materializeUpstreamPluginLayer({
      ref: "web-search@anthropics",
      name: "web-search",
      version: "1.2.0",
    });
    const v2 = materializeUpstreamPluginLayer({
      ref: "web-search@anthropics",
      name: "web-search",
      version: "1.3.0",
    });
    expect(v2.id).not.toBe(v1.id);
    expect(getLayerByName("web-search", "1.2.0")).toBeDefined();
    expect(getLayerByName("web-search", "1.3.0")).toBeDefined();
  });

  it("refuses to overwrite an authored layer of the same name", () => {
    createResource({
      type: "skill",
      name: "search",
      description: "",
      content: "x",
      metadata: {},
      source: "plugin",
      namespace: "web-search@anthropics",
      origin_kind: "marketplace_link",
      origin_ref: "web-search@anthropics",
    });
    // An authored layer already owns the name at that version.
    createLayer({ name: "web-search", version: "1.2.0" });

    expect(() =>
      materializeUpstreamPluginLayer({
        ref: "web-search@anthropics",
        name: "web-search",
        version: "1.2.0",
      }),
    ).toThrow(/authored/);
  });
});
