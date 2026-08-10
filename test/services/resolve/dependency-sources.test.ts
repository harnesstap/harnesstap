import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../../helpers/db.ts";
import type { TestContext } from "../../helpers/db.ts";
import { addResourceToLayer, createLayer } from "../../../src/models/layer-model.ts";
import { createResource } from "../../../src/models/resource.ts";
import { addDependency } from "../../../src/services/plugin-dependency.ts";
import { setLayerOrigin } from "../../../src/services/layer-origin.ts";
import { resolveComposition } from "../../../src/services/resolve/index.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("dep-src-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("resolution across dependency sources", () => {
  it("pulls an upstream plugin's resources into the resolved set", () => {
    const upstream = createLayer({ name: "web-search", version: "1.2.0" });
    setLayerOrigin(upstream.id, "upstream");
    addResourceToLayer(
      upstream.id,
      createResource({
        type: "skill",
        name: "search",
        description: "",
        content: "S",
        metadata: {},
        source: "plugin",
        namespace: "web-search@anthropics",
      }).id,
    );

    const root = createLayer({ name: "root" });
    addDependency(root.id, "web-search@anthropics", { versionConstraint: "^1.0.0" });

    const result = resolveComposition({ rootSelectors: ["root"] });
    expect(result.selected.map((s) => s.name)).toContain("web-search");
    expect(result.resources.map((r) => r.name)).toContain("search");
  });

  it("lets the root's own resource beat an upstream plugin's", () => {
    const upstream = createLayer({ name: "web-search", version: "1.2.0" });
    setLayerOrigin(upstream.id, "upstream");
    addResourceToLayer(
      upstream.id,
      createResource({
        type: "skill",
        name: "search",
        description: "",
        content: "UPSTREAM",
        metadata: {},
        source: "plugin",
        namespace: "web-search@anthropics",
      }).id,
    );

    const root = createLayer({ name: "root" });
    addResourceToLayer(
      root.id,
      createResource({
        type: "skill",
        name: "search",
        description: "",
        content: "MINE",
        metadata: {},
        source: "manual",
        namespace: "",
      }).id,
    );
    addDependency(root.id, "web-search@anthropics");

    const result = resolveComposition({ rootSelectors: ["root"] });
    const search = result.resources.find((r) => r.name === "search");
    expect(search?.content).toBe("MINE");
  });

  it("errors clearly when an upstream dependency is not installed", () => {
    const root = createLayer({ name: "root" });
    addDependency(root.id, "not-installed@anthropics", { versionConstraint: "^1.0.0" });
    expect(() => resolveComposition({ rootSelectors: ["root"] })).toThrow(
      /not-installed/,
    );
  });
});
