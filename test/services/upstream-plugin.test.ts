import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { createResource } from "../../src/models/resource.ts";
import { createPlugin, getPluginByName, getPluginResources } from "../../src/models/plugin-model.ts";
import { getPluginOrigin } from "../../src/services/plugin-origin.ts";
import { materializeUpstreamPluginPlugin } from "../../src/services/upstream-plugin-plugin.ts";

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

describe("materializeUpstreamPluginPlugin", () => {
  it("groups an install tree's resources into an upstream plugin", () => {
    linkedSkill("search", "web-search@anthropics");
    linkedSkill("summarize", "web-search@anthropics");

    const plugin = materializeUpstreamPluginPlugin({
      ref: "web-search@anthropics",
      name: "web-search",
      version: "1.2.0",
    });

    expect(plugin.name).toBe("web-search");
    expect(plugin.version).toBe("1.2.0");
    expect(getPluginOrigin(plugin.id)).toBe("upstream");
    expect(getPluginResources(plugin.id).map((r) => r.name).sort()).toEqual([
      "search",
      "summarize",
    ]);
  });

  it("is idempotent for the same ref and version", () => {
    linkedSkill("search", "web-search@anthropics");
    const first = materializeUpstreamPluginPlugin({
      ref: "web-search@anthropics",
      name: "web-search",
      version: "1.2.0",
    });
    const second = materializeUpstreamPluginPlugin({
      ref: "web-search@anthropics",
      name: "web-search",
      version: "1.2.0",
    });
    expect(second.id).toBe(first.id);
  });

  it("creates a separate row for a new upstream version", () => {
    linkedSkill("search", "web-search@anthropics");
    const v1 = materializeUpstreamPluginPlugin({
      ref: "web-search@anthropics",
      name: "web-search",
      version: "1.2.0",
    });
    const v2 = materializeUpstreamPluginPlugin({
      ref: "web-search@anthropics",
      name: "web-search",
      version: "1.3.0",
    });
    expect(v2.id).not.toBe(v1.id);
    expect(getPluginByName("web-search", "1.2.0")).toBeDefined();
    expect(getPluginByName("web-search", "1.3.0")).toBeDefined();
  });

  it("refuses to overwrite an authored plugin of the same name", () => {
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
    // An authored plugin already owns the name at that version.
    createPlugin({ name: "web-search", version: "1.2.0" });

    expect(() =>
      materializeUpstreamPluginPlugin({
        ref: "web-search@anthropics",
        name: "web-search",
        version: "1.2.0",
      }),
    ).toThrow(/authored/);
  });
});
