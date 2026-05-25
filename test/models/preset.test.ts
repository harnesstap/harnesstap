import { describe, expect, it } from "vitest";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("preset model", () => {
  it("creates and lists presets", async () => {
    const context = await createInitializedTestContext("preset-list");

    try {
      const presetModel = await import("../../src/models/preset.ts");

      const regular = presetModel.createPreset({
        name: "default",
        description: "Default preset",
        tags: ["core"],
      });
      const starter = presetModel.createPreset({
        name: "starter",
      });

      expect(presetModel.getPreset(regular.id)?.name).toBe("default");
      expect(starter.name).toBe("starter");
      expect(presetModel.getPreset("starter")?.name).toBe("starter");
      expect(presetModel.listPresets().map((preset) => preset.name)).toEqual([
        "default",
        "starter",
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("defaults version to 1.0.0 and allows explicit version", async () => {
    const context = await createInitializedTestContext("preset-version");

    try {
      const presetModel = await import("../../src/models/preset.ts");

      const p1 = presetModel.createPreset({ name: "my-preset" });
      expect(p1.version).toBe("1.0.0");

      const p2 = presetModel.createPreset({ name: "my-preset", version: "2.1.0" });
      expect(p2.version).toBe("2.1.0");

      // getPreset by name returns latest version
      const latest = presetModel.getPreset("my-preset");
      expect(latest?.version).toBe("2.1.0");

      // getPreset by id returns exact match
      expect(presetModel.getPreset(p1.id)?.version).toBe("1.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("resolves name@constraint selector", async () => {
    const context = await createInitializedTestContext("preset-selector");

    try {
      const presetModel = await import("../../src/models/preset.ts");

      presetModel.createPreset({ name: "tool", version: "1.0.0" });
      presetModel.createPreset({ name: "tool", version: "1.5.0" });
      presetModel.createPreset({ name: "tool", version: "2.0.0" });

      // exact version
      expect(presetModel.getPreset("tool@1.0.0")?.version).toBe("1.0.0");
      // range: ^1 matches highest 1.x
      expect(presetModel.getPreset("tool@^1")?.version).toBe("1.5.0");
      // range: >=2 matches 2.0.0
      expect(presetModel.getPreset("tool@>=2")?.version).toBe("2.0.0");
      // no match
      expect(presetModel.getPreset("tool@3.0.0")).toBeUndefined();
      // invalid constraint must throw, not silently return undefined
      expect(() => presetModel.getPreset("tool@not-semver")).toThrow(/invalid version constraint/i);
    } finally {
      await context.cleanup();
    }
  });

  it("parsePresetSelector identifies ids, names, and name@constraint", async () => {
    const context = await createInitializedTestContext("preset-parse-selector");

    try {
      const presetModel = await import("../../src/models/preset.ts");

      const idSelector = presetModel.parsePresetSelector("01HZXYZ1234567890ABCDEFGHJ");
      expect(idSelector.kind).toBe("id");

      const nameSelector = presetModel.parsePresetSelector("my-preset");
      expect(nameSelector.kind).toBe("name");

      const versionedSelector = presetModel.parsePresetSelector("my-preset@^1.0.0");
      expect(versionedSelector.kind).toBe("name-version");
      if (versionedSelector.kind === "name-version") {
        expect(versionedSelector.name).toBe("my-preset");
        expect(versionedSelector.constraint).toBe("^1.0.0");
      }
    } finally {
      await context.cleanup();
    }
  });

  it("associates resources in insertion order and ignores duplicates", async () => {
    const context = await createInitializedTestContext("preset-resources");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      const preset = presetModel.createPreset({ name: "bundle" });
      const first = resourceModel.createResource(
        makeResourceInput({ name: "first-skill" }),
      );
      const second = resourceModel.createResource(
        makeResourceInput({ type: "rule", name: "second-rule" }),
      );

      presetModel.addResourceToPreset(preset.id, first.id);
      presetModel.addResourceToPreset(preset.id, second.id);
      presetModel.addResourceToPreset(preset.id, first.id);

      expect(
        presetModel.getPresetResources(preset.id).map((resource) => resource.id),
      ).toEqual([first.id, second.id]);

      presetModel.removeResourceFromPreset(preset.id, first.id);

      expect(
        presetModel.getPresetResources(preset.id).map((resource) => resource.id),
      ).toEqual([second.id]);
      expect(presetModel.deletePreset(preset.id)).toBe(true);
      expect(presetModel.deletePreset(preset.id)).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("returns undefined for non-existent preset", async () => {
    const context = await createInitializedTestContext("preset-not-found");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      expect(presetModel.getPreset("non-existent-id")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("returns empty list when no presets exist", async () => {
    const context = await createInitializedTestContext("preset-empty");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      expect(presetModel.listPresets()).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("returns empty resource list for preset with no resources", async () => {
    const context = await createInitializedTestContext("preset-no-resources");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const preset = presetModel.createPreset({ name: "empty" });

      expect(presetModel.getPresetResources(preset.id)).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("adds, lists, and removes preset dependencies", async () => {
    const context = await createInitializedTestContext("preset-dependencies");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const preset = presetModel.createPreset({ name: "composite" });

      presetModel.addDependencyToPreset(preset.id, "base-preset", "^1.0.0");
      presetModel.addDependencyToPreset(preset.id, "extra-tools", ">=2.0.0");

      const deps = presetModel.listPresetDependencies(preset.id);
      expect(deps).toHaveLength(2);
      expect(deps[0].dependency_name).toBe("base-preset");
      expect(deps[0].version_constraint).toBe("^1.0.0");
      expect(deps[0].order).toBe(0);
      expect(deps[1].dependency_name).toBe("extra-tools");
      expect(deps[1].version_constraint).toBe(">=2.0.0");
      expect(deps[1].order).toBe(1);

      presetModel.removeDependencyFromPreset(preset.id, "base-preset");
      const remaining = presetModel.listPresetDependencies(preset.id);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].dependency_name).toBe("extra-tools");
    } finally {
      await context.cleanup();
    }
  });

  it("updating an existing dependency preserves its order position", async () => {
    const context = await createInitializedTestContext("preset-dep-order");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const preset = presetModel.createPreset({ name: "composite2" });

      presetModel.addDependencyToPreset(preset.id, "base", "^1.0.0");
      presetModel.addDependencyToPreset(preset.id, "extra", ">=2.0.0");

      // Re-add base with an updated constraint — order must stay at 0
      presetModel.addDependencyToPreset(preset.id, "base", "^1.5.0");

      const deps = presetModel.listPresetDependencies(preset.id);
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

  it("returns empty dependency list for preset with no dependencies", async () => {
    const context = await createInitializedTestContext("preset-no-deps");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const preset = presetModel.createPreset({ name: "standalone" });
      expect(presetModel.listPresetDependencies(preset.id)).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });
});
