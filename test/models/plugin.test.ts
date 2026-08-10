import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("plugin model", () => {
  it("creates plugins clean and unfrozen by default", async () => {
    const context = await createInitializedTestContext("plugin-dirty-defaults");
    try {
      const { createPlugin, getPluginById } = await import("../../src/models/plugin-model.ts");
      const plugin = createPlugin({ name: "clean-head", version: "1.0.0" });
      expect(plugin.dirty).toBe(false);
      expect(plugin.frozen_at).toBeUndefined();
      const reloaded = getPluginById(plugin.id);
      expect(reloaded?.dirty).toBe(false);
      expect(reloaded?.frozen_at).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("isFrozenPlugin returns true only when frozen_at is set", async () => {
    const { isFrozenPlugin } = await import("../../src/models/plugin-model.ts");
    expect(
      isFrozenPlugin({
        id: "1",
        name: "x",
        version: "1.0.0",
        org_slug: "",
        catalog_slug: "",
        description: "",
        tags: [],
        dirty: false,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      isFrozenPlugin({
        id: "1",
        name: "x",
        version: "1.0.0",
        org_slug: "",
        catalog_slug: "",
        description: "",
        tags: [],
        dirty: false,
        frozen_at: "2026-01-02T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("creates a plugin with claude config and needs", async () => {
    const context = await createInitializedTestContext("plugin-needs");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");

      const plugin = pluginModel.createPlugin({
        name: "pagerduty",
        version: "1.0.0",
        claude: { plugins: [{ id: "pd@marketplace" }] },
        needs: ["PD_TOKEN", "PD_REGION"],
      });
      expect(pluginModel.getPlugin(plugin.id)?.needs).toEqual(["PD_TOKEN", "PD_REGION"]);
    } finally {
      await context.cleanup();
    }
  });

  it("creates and lists plugins", async () => {
    const context = await createInitializedTestContext("plugin-list");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");

      const regular = pluginModel.createPlugin({
        name: "default",
        description: "Default plugin",
        tags: ["core"],
      });
      const starter = pluginModel.createPlugin({
        name: "starter",
      });

      expect(pluginModel.getPlugin(regular.id)?.name).toBe("default");
      expect(starter.name).toBe("starter");
      expect(pluginModel.getPlugin("starter")?.name).toBe("starter");
      expect(pluginModel.listPlugins().map((plugin) => plugin.name)).toEqual([
        "default",
        "starter",
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("defaults version to 1.0.0 and allows explicit version", async () => {
    const context = await createInitializedTestContext("plugin-version");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");

      const p1 = pluginModel.createPlugin({ name: "my-plugin" });
      expect(p1.version).toBe("1.0.0");

      const p2 = pluginModel.createPlugin({ name: "my-plugin", version: "2.1.0" });
      expect(p2.version).toBe("2.1.0");

      // getPlugin by name returns latest version
      const latest = pluginModel.getPlugin("my-plugin");
      expect(latest?.version).toBe("2.1.0");

      // getPlugin by id returns exact match
      expect(pluginModel.getPlugin(p1.id)?.version).toBe("1.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("resolves name@constraint selector", async () => {
    const context = await createInitializedTestContext("plugin-selector");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");

      pluginModel.createPlugin({ name: "tool", version: "1.0.0" });
      pluginModel.createPlugin({ name: "tool", version: "1.5.0" });
      pluginModel.createPlugin({ name: "tool", version: "2.0.0" });

      // exact version
      expect(pluginModel.getPlugin("tool@1.0.0")?.version).toBe("1.0.0");
      // range: ^1 matches highest 1.x
      expect(pluginModel.getPlugin("tool@^1")?.version).toBe("1.5.0");
      // range: >=2 matches 2.0.0
      expect(pluginModel.getPlugin("tool@>=2")?.version).toBe("2.0.0");
      // no match
      expect(pluginModel.getPlugin("tool@3.0.0")).toBeUndefined();
      // invalid constraint must throw, not silently return undefined
      expect(() => pluginModel.getPlugin("tool@not-semver")).toThrow(/invalid version constraint/i);
    } finally {
      await context.cleanup();
    }
  });

  it("parsePluginSelector identifies ids, names, and name@constraint", async () => {
    const context = await createInitializedTestContext("plugin-parse-selector");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");

      const idSelector = pluginModel.parsePluginSelectorString("01HZXYZ1234567890ABCDEFGHJ");
      expect(idSelector.kind).toBe("id");

      const nameSelector = pluginModel.parsePluginSelectorString("my-plugin");
      expect(nameSelector.kind).toBe("name");

      const versionedSelector = pluginModel.parsePluginSelectorString("my-plugin@^1.0.0");
      expect(versionedSelector.kind).toBe("name-version");
      if (versionedSelector.kind === "name-version") {
        expect(versionedSelector.name).toBe("my-plugin");
        expect(versionedSelector.constraint).toBe("^1.0.0");
      }
    } finally {
      await context.cleanup();
    }
  });

  it("associates resources in insertion order and ignores duplicates", async () => {
    const context = await createInitializedTestContext("plugin-resources");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      const plugin = pluginModel.createPlugin({ name: "bundle" });
      const first = resourceModel.createResource(
        makeResourceInput({ name: "first-skill" }),
      );
      const second = resourceModel.createResource(
        makeResourceInput({ type: "rule", name: "second-rule" }),
      );

      pluginModel.addResourceToPlugin(plugin.id, first.id);
      pluginModel.addResourceToPlugin(plugin.id, second.id);
      pluginModel.addResourceToPlugin(plugin.id, first.id);

      expect(
        pluginModel.getPluginResources(plugin.id).map((resource) => resource.id),
      ).toEqual([first.id, second.id]);

      pluginModel.removeResourceFromPlugin(plugin.id, first.id);

      expect(
        pluginModel.getPluginResources(plugin.id).map((resource) => resource.id),
      ).toEqual([second.id]);
      expect(pluginModel.deletePlugin(plugin.id)).toBe(true);
      expect(pluginModel.deletePlugin(plugin.id)).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("returns undefined for non-existent plugin", async () => {
    const context = await createInitializedTestContext("plugin-not-found");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      expect(pluginModel.getPlugin("non-existent-id")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("returns empty list when no plugins exist", async () => {
    const context = await createInitializedTestContext("plugin-empty");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      expect(pluginModel.listPlugins()).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("returns empty resource list for plugin with no resources", async () => {
    const context = await createInitializedTestContext("plugin-no-resources");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const plugin = pluginModel.createPlugin({ name: "empty" });

      expect(pluginModel.getPluginResources(plugin.id)).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("adds, lists, and removes plugin dependencies", async () => {
    const context = await createInitializedTestContext("plugin-dependencies");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const plugin = pluginModel.createPlugin({ name: "composite" });

      pluginModel.addDependencyToPlugin(plugin.id, "base-plugin", "^1.0.0");
      pluginModel.addDependencyToPlugin(plugin.id, "extra-tools", ">=2.0.0");

      const deps = pluginModel.listPluginDependencies(plugin.id);
      expect(deps).toHaveLength(2);
      expect(deps[0].dependency_name).toBe("base-plugin");
      expect(deps[0].version_constraint).toBe("^1.0.0");
      expect(deps[0].order).toBe(0);
      expect(deps[1].dependency_name).toBe("extra-tools");
      expect(deps[1].version_constraint).toBe(">=2.0.0");
      expect(deps[1].order).toBe(1);

      pluginModel.removeDependencyFromPlugin(plugin.id, "base-plugin");
      const remaining = pluginModel.listPluginDependencies(plugin.id);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].dependency_name).toBe("extra-tools");
    } finally {
      await context.cleanup();
    }
  });

  it("updating an existing dependency preserves its order position", async () => {
    const context = await createInitializedTestContext("plugin-dep-order");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const plugin = pluginModel.createPlugin({ name: "composite2" });

      pluginModel.addDependencyToPlugin(plugin.id, "base", "^1.0.0");
      pluginModel.addDependencyToPlugin(plugin.id, "extra", ">=2.0.0");

      // Re-add base with an updated constraint — order must stay at 0
      pluginModel.addDependencyToPlugin(plugin.id, "base", "^1.5.0");

      const deps = pluginModel.listPluginDependencies(plugin.id);
      expect(deps).toHaveLength(2);
      const base = deps.find((dep) => dep.dependency_name === "base");
      const extra = deps.find((dep) => dep.dependency_name === "extra");
      expect(base?.version_constraint).toBe("^1.5.0");
      expect(extra?.dependency_name).toBe("extra");
    } finally {
      await context.cleanup();
    }
  });

  it("returns empty dependency list for plugin with no dependencies", async () => {
    const context = await createInitializedTestContext("plugin-no-deps");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const plugin = pluginModel.createPlugin({ name: "standalone" });
      expect(pluginModel.listPluginDependencies(plugin.id)).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });
});
