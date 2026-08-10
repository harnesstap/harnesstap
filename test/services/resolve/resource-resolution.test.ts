import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../../helpers/db.ts";
import type { TestContext } from "../../helpers/db.ts";
import { addResourceToLayer, createLayer } from "../../../src/models/layer-model.ts";
import { createResource } from "../../../src/models/resource.ts";
import { resolveResources } from "../../../src/services/resolve/resource-resolution.ts";
import { SingletonConflictError } from "../../../src/services/resolve/types.ts";
import type { SelectedPlugin } from "../../../src/services/resolve/types.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("res-resolve-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function selection(
  layerId: string,
  name: string,
  depth: number,
  declarationIndex: number,
): SelectedPlugin {
  return {
    name,
    version: "1.0.0",
    layerId,
    depth,
    declarationIndex,
    constraints: [],
    reason: depth === 0 ? "root" : "mediation",
    path: [],
    source: "local",
  };
}

function attach(
  layerId: string,
  input: { type: "skill" | "instruction"; name: string; content: string; namespace?: string },
): void {
  const resource = createResource({
    type: input.type,
    name: input.name,
    description: "",
    content: input.content,
    metadata: {},
    source: "test",
    ...(input.namespace ? { namespace: input.namespace } : {}),
  });
  addResourceToLayer(layerId, resource.id);
}

describe("resolveResources", () => {
  it("materializes distinct keys from every selected layer", () => {
    const root = createLayer({ name: "root" });
    const dep = createLayer({ name: "dep" });
    attach(root.id, { type: "skill", name: "alpha", content: "A" });
    attach(dep.id, { type: "skill", name: "beta", content: "B" });

    const result = resolveResources({
      selected: [selection(root.id, "root", 0, 0), selection(dep.id, "dep", 1, 1)],
      overrides: { versions: {}, resources: {} },
      rootName: "root",
    });

    expect(result.resources.map((r) => r.name).sort()).toEqual(["alpha", "beta"]);
    expect(result.warnings).toEqual([]);
  });

  it("gives the nearest-to-root copy the win, silently", () => {
    const root = createLayer({ name: "root" });
    const dep = createLayer({ name: "dep" });
    attach(root.id, { type: "skill", name: "alpha", content: "ROOT" });
    attach(dep.id, { type: "skill", name: "alpha", content: "DEP", namespace: "dep" });

    const result = resolveResources({
      selected: [selection(root.id, "root", 0, 0), selection(dep.id, "dep", 1, 1)],
      overrides: { versions: {}, resources: {} },
      rootName: "root",
    });

    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.content).toBe("ROOT");
    const decision = result.decisions.find((d) => d.key === "skill:alpha");
    expect(decision?.reason).toBe("nearest-to-root");
    expect(decision?.winner.layerName).toBe("root");
    expect(decision?.losers[0]?.layerName).toBe("dep");
    expect(result.warnings).toEqual([]);
  });

  it("treats identical content at equal depth as a no-op", () => {
    const a = createLayer({ name: "a" });
    const b = createLayer({ name: "b" });
    attach(a.id, { type: "skill", name: "alpha", content: "SAME" });
    attach(b.id, { type: "skill", name: "alpha", content: "SAME", namespace: "b" });

    const result = resolveResources({
      selected: [selection(a.id, "a", 1, 1), selection(b.id, "b", 1, 2)],
      overrides: { versions: {}, resources: {} },
      rootName: "root",
    });

    expect(result.resources).toHaveLength(1);
    expect(result.decisions[0]?.reason).toBe("identical-content");
    expect(result.warnings).toEqual([]);
  });

  it("warns and lets the last declaration win for set-like equal-depth conflicts", () => {
    const a = createLayer({ name: "a" });
    const b = createLayer({ name: "b" });
    attach(a.id, { type: "skill", name: "alpha", content: "FROM-A" });
    attach(b.id, { type: "skill", name: "alpha", content: "FROM-B", namespace: "b" });

    const result = resolveResources({
      selected: [selection(a.id, "a", 1, 1), selection(b.id, "b", 1, 2)],
      overrides: { versions: {}, resources: {} },
      rootName: "root",
    });

    expect(result.resources[0]?.content).toBe("FROM-B");
    expect(result.decisions[0]?.reason).toBe("declaration-order");
    expect(result.warnings[0]).toContain("skill:alpha");
    expect(result.warnings[0]).toContain("b");
  });

  it("errors on a singleton equal-depth conflict", () => {
    const a = createLayer({ name: "a" });
    const b = createLayer({ name: "b" });
    attach(a.id, { type: "instruction", name: "context", content: "FROM-A" });
    attach(b.id, {
      type: "instruction",
      name: "context",
      content: "FROM-B",
      namespace: "b",
    });

    expect(() =>
      resolveResources({
        selected: [selection(a.id, "a", 1, 1), selection(b.id, "b", 1, 2)],
        overrides: { versions: {}, resources: {} },
        rootName: "my-setup",
      }),
    ).toThrow(SingletonConflictError);
  });

  it("last-wins singleton ties when declarationOrderSingletons is set", () => {
    const a = createLayer({ name: "a" });
    const b = createLayer({ name: "b" });
    attach(a.id, { type: "instruction", name: "context", content: "FROM-A" });
    attach(b.id, {
      type: "instruction",
      name: "context",
      content: "FROM-B",
      namespace: "b",
    });

    const result = resolveResources({
      selected: [selection(a.id, "a", 1, 1), selection(b.id, "b", 1, 2)],
      overrides: { versions: {}, resources: {} },
      rootName: "__ht_ephemeral_root__",
      declarationOrderSingletons: true,
    });

    expect(result.resources[0]?.content).toBe("FROM-B");
    expect(result.decisions[0]?.reason).toBe("declaration-order");
    expect(result.warnings[0]).toContain("instruction:context");
  });

  it("honors a root resource override over depth", () => {
    const root = createLayer({ name: "root" });
    const dep = createLayer({ name: "dep" });
    attach(root.id, { type: "skill", name: "alpha", content: "ROOT" });
    attach(dep.id, { type: "skill", name: "alpha", content: "DEP", namespace: "dep" });

    const result = resolveResources({
      selected: [selection(root.id, "root", 0, 0), selection(dep.id, "dep", 1, 1)],
      overrides: { versions: {}, resources: { "skill:alpha": "dep" } },
      rootName: "root",
    });

    expect(result.resources[0]?.content).toBe("DEP");
    expect(result.decisions[0]?.reason).toBe("root-override");
  });
});
