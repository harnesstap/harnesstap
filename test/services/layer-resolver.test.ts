import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("resolveLayerGraph", () => {
  it("resolves a single layer with no dependencies", async () => {
    const context = await createInitializedTestContext("resolver-single");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const { resolveLayerGraph } = await import(
        "../../src/services/layer-resolver.ts"
      );

      layerModel.createLayer({ name: "base", version: "1.0.0" });

      const result = resolveLayerGraph(["base"]);

      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0].name).toBe("base");
      expect(result.dependencyMap[result.resolved[0].id]).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("selects the highest compatible version", async () => {
    const context = await createInitializedTestContext("resolver-highest");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const { resolveLayerGraph } = await import(
        "../../src/services/layer-resolver.ts"
      );

      layerModel.createLayer({ name: "tool", version: "1.0.0" });
      layerModel.createLayer({ name: "tool", version: "1.5.0" });
      layerModel.createLayer({ name: "tool", version: "2.0.0" });

      const result = resolveLayerGraph(["tool@^1"]);

      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0].version).toBe("1.5.0");
    } finally {
      await context.cleanup();
    }
  });

  it("resolves a linear dependency chain in topological order", async () => {
    const context = await createInitializedTestContext("resolver-chain");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const { resolveLayerGraph } = await import(
        "../../src/services/layer-resolver.ts"
      );

      const base = layerModel.createLayer({ name: "base", version: "1.0.0" });
      const mid = layerModel.createLayer({ name: "mid", version: "1.0.0" });
      const top = layerModel.createLayer({ name: "top", version: "1.0.0" });

      layerModel.addDependencyToLayer(top.id, "mid", "^1.0.0");
      layerModel.addDependencyToLayer(mid.id, "base", "^1.0.0");

      const result = resolveLayerGraph(["top"]);

      expect(result.resolved.map((p) => p.name)).toEqual(["base", "mid", "top"]);
      expect(result.dependencyMap[top.id]).toEqual([mid.id]);
      expect(result.dependencyMap[mid.id]).toEqual([base.id]);
      expect(result.dependencyMap[base.id]).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("deduplicates shared dependencies (diamond pattern)", async () => {
    const context = await createInitializedTestContext("resolver-diamond");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const { resolveLayerGraph } = await import(
        "../../src/services/layer-resolver.ts"
      );

      layerModel.createLayer({ name: "shared", version: "1.0.0" });
      const left = layerModel.createLayer({ name: "left", version: "1.0.0" });
      const right = layerModel.createLayer({ name: "right", version: "1.0.0" });
      const root = layerModel.createLayer({ name: "root", version: "1.0.0" });

      layerModel.addDependencyToLayer(left.id, "shared", "^1.0.0");
      layerModel.addDependencyToLayer(right.id, "shared", "^1.0.0");
      layerModel.addDependencyToLayer(root.id, "left", "^1.0.0");
      layerModel.addDependencyToLayer(root.id, "right", "^1.0.0");

      const result = resolveLayerGraph(["root"]);

      // shared appears only once
      const names = result.resolved.map((p) => p.name);
      expect(names.filter((n) => n === "shared")).toHaveLength(1);

      // shared comes before left and right, which come before root
      const sharedIdx = names.indexOf("shared");
      const leftIdx = names.indexOf("left");
      const rightIdx = names.indexOf("right");
      const rootIdx = names.indexOf("root");
      expect(sharedIdx).toBeLessThan(leftIdx);
      expect(sharedIdx).toBeLessThan(rightIdx);
      expect(leftIdx).toBeLessThan(rootIdx);
      expect(rightIdx).toBeLessThan(rootIdx);
    } finally {
      await context.cleanup();
    }
  });

  it("handles multiple root selectors without duplicating shared layers", async () => {
    const context = await createInitializedTestContext("resolver-multi-root");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const { resolveLayerGraph } = await import(
        "../../src/services/layer-resolver.ts"
      );

      layerModel.createLayer({ name: "a", version: "1.0.0" });
      layerModel.createLayer({ name: "b", version: "1.0.0" });

      const result = resolveLayerGraph(["a", "b", "a"]);

      const names = result.resolved.map((p) => p.name);
      expect(names.filter((n) => n === "a")).toHaveLength(1);
      expect(names).toContain("b");
    } finally {
      await context.cleanup();
    }
  });

  it("throws on a direct cycle (A → B → A)", async () => {
    const context = await createInitializedTestContext("resolver-cycle");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const { resolveLayerGraph } = await import(
        "../../src/services/layer-resolver.ts"
      );

      const a = layerModel.createLayer({ name: "a", version: "1.0.0" });
      const b = layerModel.createLayer({ name: "b", version: "1.0.0" });

      layerModel.addDependencyToLayer(a.id, "b", "^1.0.0");
      layerModel.addDependencyToLayer(b.id, "a", "^1.0.0");

      expect(() => resolveLayerGraph(["a"])).toThrow(/cycle/i);
    } finally {
      await context.cleanup();
    }
  });

  it("throws on a transitive cycle (A → B → C → A)", async () => {
    const context = await createInitializedTestContext("resolver-trans-cycle");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const { resolveLayerGraph } = await import(
        "../../src/services/layer-resolver.ts"
      );

      const a = layerModel.createLayer({ name: "a", version: "1.0.0" });
      const b = layerModel.createLayer({ name: "b", version: "1.0.0" });
      const c = layerModel.createLayer({ name: "c", version: "1.0.0" });

      layerModel.addDependencyToLayer(a.id, "b", "^1.0.0");
      layerModel.addDependencyToLayer(b.id, "c", "^1.0.0");
      layerModel.addDependencyToLayer(c.id, "a", "^1.0.0");

      expect(() => resolveLayerGraph(["a"])).toThrow(/cycle/i);
    } finally {
      await context.cleanup();
    }
  });

  it("throws when no compatible version exists for a root selector", async () => {
    const context = await createInitializedTestContext("resolver-missing-root");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const { resolveLayerGraph } = await import(
        "../../src/services/layer-resolver.ts"
      );

      layerModel.createLayer({ name: "tool", version: "1.0.0" });

      expect(() => resolveLayerGraph(["tool@^2.0.0"])).toThrow(
        /no compatible version/i,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("throws when no compatible version exists for a transitive dependency", async () => {
    const context = await createInitializedTestContext("resolver-missing-dep");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const { resolveLayerGraph } = await import(
        "../../src/services/layer-resolver.ts"
      );

      const parent = layerModel.createLayer({ name: "parent", version: "1.0.0" });
      layerModel.createLayer({ name: "child", version: "1.0.0" });

      layerModel.addDependencyToLayer(parent.id, "child", "^2.0.0");

      expect(() => resolveLayerGraph(["parent"])).toThrow(
        /no compatible version/i,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("throws when a dependency layer name does not exist at all", async () => {
    const context = await createInitializedTestContext("resolver-nonexistent");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const { resolveLayerGraph } = await import(
        "../../src/services/layer-resolver.ts"
      );

      const parent = layerModel.createLayer({ name: "parent", version: "1.0.0" });
      layerModel.addDependencyToLayer(parent.id, "ghost", "^1.0.0");

      expect(() => resolveLayerGraph(["parent"])).toThrow(
        /no compatible version/i,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("error message for cycle includes layer names", async () => {
    const context = await createInitializedTestContext("resolver-cycle-msg");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const { resolveLayerGraph } = await import(
        "../../src/services/layer-resolver.ts"
      );

      const a = layerModel.createLayer({ name: "alpha", version: "1.0.0" });
      const b = layerModel.createLayer({ name: "beta", version: "1.0.0" });

      layerModel.addDependencyToLayer(a.id, "beta", "^1.0.0");
      layerModel.addDependencyToLayer(b.id, "alpha", "^1.0.0");

      expect(() => resolveLayerGraph(["alpha"])).toThrow(/alpha|beta/i);
    } finally {
      await context.cleanup();
    }
  });

  it("resolves a layer by id selector", async () => {
    const context = await createInitializedTestContext("resolver-by-id");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const { resolveLayerGraph } = await import(
        "../../src/services/layer-resolver.ts"
      );

      const p = layerModel.createLayer({ name: "named", version: "1.0.0" });

      const result = resolveLayerGraph([p.id]);

      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0].id).toBe(p.id);
    } finally {
      await context.cleanup();
    }
  });

  it("throws when two root selectors require incompatible versions of the same layer", async () => {
    const context = await createInitializedTestContext("resolver-conflict-roots");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const { resolveLayerGraph } = await import(
        "../../src/services/layer-resolver.ts"
      );

      layerModel.createLayer({ name: "tool", version: "1.0.0" });
      layerModel.createLayer({ name: "tool", version: "2.0.0" });

      // first root resolves tool to 1.x, second demands ^2 — conflict
      expect(() => resolveLayerGraph(["tool@^1", "tool@^2"])).toThrow(
        /conflicting constraints/i,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("throws when two transitive paths require incompatible versions of a shared layer", async () => {
    const context = await createInitializedTestContext("resolver-conflict-trans");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const { resolveLayerGraph } = await import(
        "../../src/services/layer-resolver.ts"
      );

      layerModel.createLayer({ name: "shared", version: "1.0.0" });
      layerModel.createLayer({ name: "shared", version: "2.0.0" });

      const left = layerModel.createLayer({ name: "left", version: "1.0.0" });
      const right = layerModel.createLayer({ name: "right", version: "1.0.0" });
      const root = layerModel.createLayer({ name: "root", version: "1.0.0" });

      // left wants shared@^1, right wants shared@^2
      layerModel.addDependencyToLayer(left.id, "shared", "^1.0.0");
      layerModel.addDependencyToLayer(right.id, "shared", "^2.0.0");
      layerModel.addDependencyToLayer(root.id, "left", "^1.0.0");
      layerModel.addDependencyToLayer(root.id, "right", "^1.0.0");

      expect(() => resolveLayerGraph(["root"])).toThrow(/conflicting constraints/i);
    } finally {
      await context.cleanup();
    }
  });

  it("does not throw when two paths request compatible constraints on the same layer", async () => {
    const context = await createInitializedTestContext("resolver-compat-constraints");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const { resolveLayerGraph } = await import(
        "../../src/services/layer-resolver.ts"
      );

      layerModel.createLayer({ name: "shared", version: "1.5.0" });

      const left = layerModel.createLayer({ name: "left", version: "1.0.0" });
      const right = layerModel.createLayer({ name: "right", version: "1.0.0" });
      const root = layerModel.createLayer({ name: "root", version: "1.0.0" });

      // both want ^1 — 1.5.0 satisfies both
      layerModel.addDependencyToLayer(left.id, "shared", "^1.0.0");
      layerModel.addDependencyToLayer(right.id, "shared", "^1.0.0");
      layerModel.addDependencyToLayer(root.id, "left", "^1.0.0");
      layerModel.addDependencyToLayer(root.id, "right", "^1.0.0");

      const result = resolveLayerGraph(["root"]);

      const names = result.resolved.map((p) => p.name);
      expect(names.filter((n) => n === "shared")).toHaveLength(1);
      expect(result.resolved.find((p) => p.name === "shared")?.version).toBe("1.5.0");
    } finally {
      await context.cleanup();
    }
  });

  it("throws when an id selector conflicts with an already-resolved name (order-dependent case)", async () => {
    const context = await createInitializedTestContext("resolver-id-conflict");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const { resolveLayerGraph } = await import(
        "../../src/services/layer-resolver.ts"
      );

      layerModel.createLayer({ name: "tool", version: "1.0.0" });
      const v2 = layerModel.createLayer({ name: "tool", version: "2.0.0" });

      // First root resolves tool to the highest ^1 match (1.0.0);
      // second root is an explicit ULID for tool v2 — should conflict.
      expect(() => resolveLayerGraph(["tool@^1", v2.id])).toThrow(
        /conflicting selectors/i,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("does not throw when an id selector matches the already-resolved layer", async () => {
    const context = await createInitializedTestContext("resolver-id-same");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const { resolveLayerGraph } = await import(
        "../../src/services/layer-resolver.ts"
      );

      const v1 = layerModel.createLayer({ name: "tool", version: "1.0.0" });

      // name selector and id selector both refer to the same layer — fine
      const result = resolveLayerGraph(["tool@^1", v1.id]);

      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0].id).toBe(v1.id);
    } finally {
      await context.cleanup();
    }
  });
});
