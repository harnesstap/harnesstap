import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("layer model", () => {
  it("creates and lists layers", async () => {
    const context = await createInitializedTestContext("layer-list");

    try {
      const layerModel = await import("../../src/models/layer.ts");

      const regular = layerModel.createLayer({
        name: "default",
        description: "Default layer",
        tags: ["core"],
      });
      const starter = layerModel.createLayer({
        name: "starter",
      });

      expect(layerModel.getLayer(regular.id)?.name).toBe("default");
      expect(starter.name).toBe("starter");
      expect(layerModel.getLayer("starter")?.name).toBe("starter");
      expect(layerModel.listLayers().map((layer) => layer.name)).toEqual([
        "default",
        "starter",
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("defaults version to 1.0.0 and allows explicit version", async () => {
    const context = await createInitializedTestContext("layer-version");

    try {
      const layerModel = await import("../../src/models/layer.ts");

      const p1 = layerModel.createLayer({ name: "my-layer" });
      expect(p1.version).toBe("1.0.0");

      const p2 = layerModel.createLayer({ name: "my-layer", version: "2.1.0" });
      expect(p2.version).toBe("2.1.0");

      // getLayer by name returns latest version
      const latest = layerModel.getLayer("my-layer");
      expect(latest?.version).toBe("2.1.0");

      // getLayer by id returns exact match
      expect(layerModel.getLayer(p1.id)?.version).toBe("1.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("resolves name@constraint selector", async () => {
    const context = await createInitializedTestContext("layer-selector");

    try {
      const layerModel = await import("../../src/models/layer.ts");

      layerModel.createLayer({ name: "tool", version: "1.0.0" });
      layerModel.createLayer({ name: "tool", version: "1.5.0" });
      layerModel.createLayer({ name: "tool", version: "2.0.0" });

      // exact version
      expect(layerModel.getLayer("tool@1.0.0")?.version).toBe("1.0.0");
      // range: ^1 matches highest 1.x
      expect(layerModel.getLayer("tool@^1")?.version).toBe("1.5.0");
      // range: >=2 matches 2.0.0
      expect(layerModel.getLayer("tool@>=2")?.version).toBe("2.0.0");
      // no match
      expect(layerModel.getLayer("tool@3.0.0")).toBeUndefined();
      // invalid constraint must throw, not silently return undefined
      expect(() => layerModel.getLayer("tool@not-semver")).toThrow(/invalid version constraint/i);
    } finally {
      await context.cleanup();
    }
  });

  it("parseLayerSelector identifies ids, names, and name@constraint", async () => {
    const context = await createInitializedTestContext("layer-parse-selector");

    try {
      const layerModel = await import("../../src/models/layer.ts");

      const idSelector = layerModel.parseLayerSelector("01HZXYZ1234567890ABCDEFGHJ");
      expect(idSelector.kind).toBe("id");

      const nameSelector = layerModel.parseLayerSelector("my-layer");
      expect(nameSelector.kind).toBe("name");

      const versionedSelector = layerModel.parseLayerSelector("my-layer@^1.0.0");
      expect(versionedSelector.kind).toBe("name-version");
      if (versionedSelector.kind === "name-version") {
        expect(versionedSelector.name).toBe("my-layer");
        expect(versionedSelector.constraint).toBe("^1.0.0");
      }
    } finally {
      await context.cleanup();
    }
  });

  it("associates resources in insertion order and ignores duplicates", async () => {
    const context = await createInitializedTestContext("layer-resources");

    try {
      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      const layer = layerModel.createLayer({ name: "bundle" });
      const first = resourceModel.createResource(
        makeResourceInput({ name: "first-skill" }),
      );
      const second = resourceModel.createResource(
        makeResourceInput({ type: "rule", name: "second-rule" }),
      );

      layerModel.addResourceToLayer(layer.id, first.id);
      layerModel.addResourceToLayer(layer.id, second.id);
      layerModel.addResourceToLayer(layer.id, first.id);

      expect(
        layerModel.getLayerResources(layer.id).map((resource) => resource.id),
      ).toEqual([first.id, second.id]);

      layerModel.removeResourceFromLayer(layer.id, first.id);

      expect(
        layerModel.getLayerResources(layer.id).map((resource) => resource.id),
      ).toEqual([second.id]);
      expect(layerModel.deleteLayer(layer.id)).toBe(true);
      expect(layerModel.deleteLayer(layer.id)).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("returns undefined for non-existent layer", async () => {
    const context = await createInitializedTestContext("layer-not-found");

    try {
      const layerModel = await import("../../src/models/layer.ts");
      expect(layerModel.getLayer("non-existent-id")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("returns empty list when no layers exist", async () => {
    const context = await createInitializedTestContext("layer-empty");

    try {
      const layerModel = await import("../../src/models/layer.ts");
      expect(layerModel.listLayers()).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("returns empty resource list for layer with no resources", async () => {
    const context = await createInitializedTestContext("layer-no-resources");

    try {
      const layerModel = await import("../../src/models/layer.ts");
      const layer = layerModel.createLayer({ name: "empty" });

      expect(layerModel.getLayerResources(layer.id)).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("adds, lists, and removes layer dependencies", async () => {
    const context = await createInitializedTestContext("layer-dependencies");

    try {
      const layerModel = await import("../../src/models/layer.ts");
      const layer = layerModel.createLayer({ name: "composite" });

      layerModel.addDependencyToLayer(layer.id, "base-layer", "^1.0.0");
      layerModel.addDependencyToLayer(layer.id, "extra-tools", ">=2.0.0");

      const deps = layerModel.listLayerDependencies(layer.id);
      expect(deps).toHaveLength(2);
      expect(deps[0].dependency_name).toBe("base-layer");
      expect(deps[0].version_constraint).toBe("^1.0.0");
      expect(deps[0].order).toBe(0);
      expect(deps[1].dependency_name).toBe("extra-tools");
      expect(deps[1].version_constraint).toBe(">=2.0.0");
      expect(deps[1].order).toBe(1);

      layerModel.removeDependencyFromLayer(layer.id, "base-layer");
      const remaining = layerModel.listLayerDependencies(layer.id);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].dependency_name).toBe("extra-tools");
    } finally {
      await context.cleanup();
    }
  });

  it("updating an existing dependency preserves its order position", async () => {
    const context = await createInitializedTestContext("layer-dep-order");

    try {
      const layerModel = await import("../../src/models/layer.ts");
      const layer = layerModel.createLayer({ name: "composite2" });

      layerModel.addDependencyToLayer(layer.id, "base", "^1.0.0");
      layerModel.addDependencyToLayer(layer.id, "extra", ">=2.0.0");

      // Re-add base with an updated constraint — order must stay at 0
      layerModel.addDependencyToLayer(layer.id, "base", "^1.5.0");

      const deps = layerModel.listLayerDependencies(layer.id);
      expect(deps).toHaveLength(2);
      expect(deps[0].dependency_name).toBe("base");
      expect(deps[0].version_constraint).toBe("^1.5.0");
      expect(deps[0].order).toBe(0);
      expect(deps[1].dependency_name).toBe("extra");
      expect(deps[1].order).toBe(1);
    } finally {
      await context.cleanup();
    }
  });

  it("returns empty dependency list for layer with no dependencies", async () => {
    const context = await createInitializedTestContext("layer-no-deps");

    try {
      const layerModel = await import("../../src/models/layer.ts");
      const layer = layerModel.createLayer({ name: "standalone" });
      expect(layerModel.listLayerDependencies(layer.id)).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });
});
