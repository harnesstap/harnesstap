import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("resolvePresetGraph", () => {
  it("resolves a single preset with no dependencies", async () => {
    const context = await createInitializedTestContext("resolver-single");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const { resolvePresetGraph } = await import(
        "../../src/services/preset-resolver.ts"
      );

      presetModel.createPreset({ name: "base", version: "1.0.0" });

      const result = resolvePresetGraph(["base"]);

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
      const presetModel = await import("../../src/models/preset.ts");
      const { resolvePresetGraph } = await import(
        "../../src/services/preset-resolver.ts"
      );

      presetModel.createPreset({ name: "tool", version: "1.0.0" });
      presetModel.createPreset({ name: "tool", version: "1.5.0" });
      presetModel.createPreset({ name: "tool", version: "2.0.0" });

      const result = resolvePresetGraph(["tool@^1"]);

      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0].version).toBe("1.5.0");
    } finally {
      await context.cleanup();
    }
  });

  it("resolves a linear dependency chain in topological order", async () => {
    const context = await createInitializedTestContext("resolver-chain");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const { resolvePresetGraph } = await import(
        "../../src/services/preset-resolver.ts"
      );

      const base = presetModel.createPreset({ name: "base", version: "1.0.0" });
      const mid = presetModel.createPreset({ name: "mid", version: "1.0.0" });
      const top = presetModel.createPreset({ name: "top", version: "1.0.0" });

      presetModel.addDependencyToPreset(top.id, "mid", "^1.0.0");
      presetModel.addDependencyToPreset(mid.id, "base", "^1.0.0");

      const result = resolvePresetGraph(["top"]);

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
      const presetModel = await import("../../src/models/preset.ts");
      const { resolvePresetGraph } = await import(
        "../../src/services/preset-resolver.ts"
      );

      presetModel.createPreset({ name: "shared", version: "1.0.0" });
      const left = presetModel.createPreset({ name: "left", version: "1.0.0" });
      const right = presetModel.createPreset({ name: "right", version: "1.0.0" });
      const root = presetModel.createPreset({ name: "root", version: "1.0.0" });

      presetModel.addDependencyToPreset(left.id, "shared", "^1.0.0");
      presetModel.addDependencyToPreset(right.id, "shared", "^1.0.0");
      presetModel.addDependencyToPreset(root.id, "left", "^1.0.0");
      presetModel.addDependencyToPreset(root.id, "right", "^1.0.0");

      const result = resolvePresetGraph(["root"]);

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

  it("handles multiple root selectors without duplicating shared presets", async () => {
    const context = await createInitializedTestContext("resolver-multi-root");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const { resolvePresetGraph } = await import(
        "../../src/services/preset-resolver.ts"
      );

      presetModel.createPreset({ name: "a", version: "1.0.0" });
      presetModel.createPreset({ name: "b", version: "1.0.0" });

      const result = resolvePresetGraph(["a", "b", "a"]);

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
      const presetModel = await import("../../src/models/preset.ts");
      const { resolvePresetGraph } = await import(
        "../../src/services/preset-resolver.ts"
      );

      const a = presetModel.createPreset({ name: "a", version: "1.0.0" });
      const b = presetModel.createPreset({ name: "b", version: "1.0.0" });

      presetModel.addDependencyToPreset(a.id, "b", "^1.0.0");
      presetModel.addDependencyToPreset(b.id, "a", "^1.0.0");

      expect(() => resolvePresetGraph(["a"])).toThrow(/cycle/i);
    } finally {
      await context.cleanup();
    }
  });

  it("throws on a transitive cycle (A → B → C → A)", async () => {
    const context = await createInitializedTestContext("resolver-trans-cycle");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const { resolvePresetGraph } = await import(
        "../../src/services/preset-resolver.ts"
      );

      const a = presetModel.createPreset({ name: "a", version: "1.0.0" });
      const b = presetModel.createPreset({ name: "b", version: "1.0.0" });
      const c = presetModel.createPreset({ name: "c", version: "1.0.0" });

      presetModel.addDependencyToPreset(a.id, "b", "^1.0.0");
      presetModel.addDependencyToPreset(b.id, "c", "^1.0.0");
      presetModel.addDependencyToPreset(c.id, "a", "^1.0.0");

      expect(() => resolvePresetGraph(["a"])).toThrow(/cycle/i);
    } finally {
      await context.cleanup();
    }
  });

  it("throws when no compatible version exists for a root selector", async () => {
    const context = await createInitializedTestContext("resolver-missing-root");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const { resolvePresetGraph } = await import(
        "../../src/services/preset-resolver.ts"
      );

      presetModel.createPreset({ name: "tool", version: "1.0.0" });

      expect(() => resolvePresetGraph(["tool@^2.0.0"])).toThrow(
        /no compatible version/i,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("throws when no compatible version exists for a transitive dependency", async () => {
    const context = await createInitializedTestContext("resolver-missing-dep");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const { resolvePresetGraph } = await import(
        "../../src/services/preset-resolver.ts"
      );

      const parent = presetModel.createPreset({ name: "parent", version: "1.0.0" });
      presetModel.createPreset({ name: "child", version: "1.0.0" });

      presetModel.addDependencyToPreset(parent.id, "child", "^2.0.0");

      expect(() => resolvePresetGraph(["parent"])).toThrow(
        /no compatible version/i,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("throws when a dependency preset name does not exist at all", async () => {
    const context = await createInitializedTestContext("resolver-nonexistent");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const { resolvePresetGraph } = await import(
        "../../src/services/preset-resolver.ts"
      );

      const parent = presetModel.createPreset({ name: "parent", version: "1.0.0" });
      presetModel.addDependencyToPreset(parent.id, "ghost", "^1.0.0");

      expect(() => resolvePresetGraph(["parent"])).toThrow(
        /no compatible version/i,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("error message for cycle includes preset names", async () => {
    const context = await createInitializedTestContext("resolver-cycle-msg");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const { resolvePresetGraph } = await import(
        "../../src/services/preset-resolver.ts"
      );

      const a = presetModel.createPreset({ name: "alpha", version: "1.0.0" });
      const b = presetModel.createPreset({ name: "beta", version: "1.0.0" });

      presetModel.addDependencyToPreset(a.id, "beta", "^1.0.0");
      presetModel.addDependencyToPreset(b.id, "alpha", "^1.0.0");

      expect(() => resolvePresetGraph(["alpha"])).toThrow(/alpha|beta/i);
    } finally {
      await context.cleanup();
    }
  });

  it("resolves a preset by id selector", async () => {
    const context = await createInitializedTestContext("resolver-by-id");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const { resolvePresetGraph } = await import(
        "../../src/services/preset-resolver.ts"
      );

      const p = presetModel.createPreset({ name: "named", version: "1.0.0" });

      const result = resolvePresetGraph([p.id]);

      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0].id).toBe(p.id);
    } finally {
      await context.cleanup();
    }
  });

  it("throws when two root selectors require incompatible versions of the same preset", async () => {
    const context = await createInitializedTestContext("resolver-conflict-roots");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const { resolvePresetGraph } = await import(
        "../../src/services/preset-resolver.ts"
      );

      presetModel.createPreset({ name: "tool", version: "1.0.0" });
      presetModel.createPreset({ name: "tool", version: "2.0.0" });

      // first root resolves tool to 1.x, second demands ^2 — conflict
      expect(() => resolvePresetGraph(["tool@^1", "tool@^2"])).toThrow(
        /conflicting constraints/i,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("throws when two transitive paths require incompatible versions of a shared preset", async () => {
    const context = await createInitializedTestContext("resolver-conflict-trans");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const { resolvePresetGraph } = await import(
        "../../src/services/preset-resolver.ts"
      );

      presetModel.createPreset({ name: "shared", version: "1.0.0" });
      presetModel.createPreset({ name: "shared", version: "2.0.0" });

      const left = presetModel.createPreset({ name: "left", version: "1.0.0" });
      const right = presetModel.createPreset({ name: "right", version: "1.0.0" });
      const root = presetModel.createPreset({ name: "root", version: "1.0.0" });

      // left wants shared@^1, right wants shared@^2
      presetModel.addDependencyToPreset(left.id, "shared", "^1.0.0");
      presetModel.addDependencyToPreset(right.id, "shared", "^2.0.0");
      presetModel.addDependencyToPreset(root.id, "left", "^1.0.0");
      presetModel.addDependencyToPreset(root.id, "right", "^1.0.0");

      expect(() => resolvePresetGraph(["root"])).toThrow(/conflicting constraints/i);
    } finally {
      await context.cleanup();
    }
  });

  it("does not throw when two paths request compatible constraints on the same preset", async () => {
    const context = await createInitializedTestContext("resolver-compat-constraints");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const { resolvePresetGraph } = await import(
        "../../src/services/preset-resolver.ts"
      );

      presetModel.createPreset({ name: "shared", version: "1.5.0" });

      const left = presetModel.createPreset({ name: "left", version: "1.0.0" });
      const right = presetModel.createPreset({ name: "right", version: "1.0.0" });
      const root = presetModel.createPreset({ name: "root", version: "1.0.0" });

      // both want ^1 — 1.5.0 satisfies both
      presetModel.addDependencyToPreset(left.id, "shared", "^1.0.0");
      presetModel.addDependencyToPreset(right.id, "shared", "^1.0.0");
      presetModel.addDependencyToPreset(root.id, "left", "^1.0.0");
      presetModel.addDependencyToPreset(root.id, "right", "^1.0.0");

      const result = resolvePresetGraph(["root"]);

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
      const presetModel = await import("../../src/models/preset.ts");
      const { resolvePresetGraph } = await import(
        "../../src/services/preset-resolver.ts"
      );

      presetModel.createPreset({ name: "tool", version: "1.0.0" });
      const v2 = presetModel.createPreset({ name: "tool", version: "2.0.0" });

      // First root resolves tool to the highest ^1 match (1.0.0);
      // second root is an explicit ULID for tool v2 — should conflict.
      expect(() => resolvePresetGraph(["tool@^1", v2.id])).toThrow(
        /conflicting selectors/i,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("does not throw when an id selector matches the already-resolved preset", async () => {
    const context = await createInitializedTestContext("resolver-id-same");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const { resolvePresetGraph } = await import(
        "../../src/services/preset-resolver.ts"
      );

      const v1 = presetModel.createPreset({ name: "tool", version: "1.0.0" });

      // name selector and id selector both refer to the same preset — fine
      const result = resolvePresetGraph(["tool@^1", v1.id]);

      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0].id).toBe(v1.id);
    } finally {
      await context.cleanup();
    }
  });
});
