import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
} from "../../src/models/plugin-model.ts";
import { isProfilePlugin } from "../../src/constants/profile.ts";
import { ensurePluginResource } from "../../src/services/plugin-composition.ts";
import {
  getPluginOverrides,
  setPluginVersionOverride,
  clearPluginVersionOverride,
} from "../../src/services/plugin-overrides.ts";
import { addDependency, listDependencies } from "../../src/services/plugin-dependency.ts";
import { runConstraintRecovery } from "../../src/services/constraint-recovery.ts";
import * as pluginPinApply from "../../src/services/plugin-pin-apply.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("constraint-recovery-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("clearPluginVersionOverride", () => {
  it("removes one version override and leaves others", () => {
    const root = createPlugin({ name: "root" });
    setPluginVersionOverride(root.id, "base", "1.2.0");
    setPluginVersionOverride(root.id, "other", "2.0.0");
    clearPluginVersionOverride(root.id, "base");
    expect(getPluginOverrides(root.id).versions).toEqual({ other: "2.0.0" });
  });
});

describe("runConstraintRecovery", () => {
  it("detaches a dependency from the root", async () => {
    const root = createPlugin({ name: "Teads (Default)", version: "1.0.1" });
    createPlugin({ name: "design-doc", version: "1.0.0" });
    const ref = ensurePluginResource("plugin:design-doc");
    addResourceToPlugin(root.id, ref.id);

    await runConstraintRecovery({
      rootName: "Teads (Default)",
      action: {
        id: "detach-dependency",
        label: "Detach design-doc",
        rootName: "Teads (Default)",
        pluginName: "design-doc",
      },
    });

    expect(listDependencies(root.id)).toEqual([]);
  });

  it("sets a version override on the root", async () => {
    const root = createPlugin({ name: "my-setup" });
    createPlugin({ name: "base", version: "1.2.0" });

    await runConstraintRecovery({
      rootName: "my-setup",
      action: {
        id: "override-version",
        label: "Override base",
        pluginName: "base",
        versions: ["1.2.0"],
        rootName: "my-setup",
      },
      chosenVersion: "1.2.0",
    });

    expect(getPluginOverrides(root.id).versions.base).toBe("1.2.0");
  });

  it("clears a version override on the root", async () => {
    const root = createPlugin({ name: "root" });
    setPluginVersionOverride(root.id, "base", "9.9.9");

    await runConstraintRecovery({
      rootName: "root",
      action: {
        id: "clear-override",
        label: "Clear",
        rootName: "root",
        pluginName: "base",
      },
    });

    expect(getPluginOverrides(root.id).versions.base).toBeUndefined();
  });

  it("creates a local plugin for create-plugin recovery", async () => {
    createPlugin({ name: "my-setup" });
    expect(getPluginByName("missing-plugin")).toBeUndefined();

    await runConstraintRecovery({
      rootName: "my-setup",
      action: {
        id: "create-plugin",
        label: "Create missing-plugin",
        pluginName: "missing-plugin",
      },
    });

    expect(getPluginByName("missing-plugin")?.name).toBe("missing-plugin");
  });

  it("sets a resource override for override-resource recovery", async () => {
    const root = createPlugin({ name: "my-setup" });

    await runConstraintRecovery({
      rootName: "my-setup",
      action: {
        id: "override-resource",
        label: "Use a for instruction:context",
        rootName: "my-setup",
        key: "instruction:context",
        winnerPluginName: "a",
      },
    });

    expect(getPluginOverrides(root.id).resources).toEqual({
      "instruction:context": "a",
    });
  });

  it("tags the plugin as a profile for tag-as-profile recovery", async () => {
    const plugin = createPlugin({ name: "focus" });
    expect(isProfilePlugin(plugin)).toBe(false);

    await runConstraintRecovery({
      rootName: "focus",
      action: {
        id: "tag-as-profile",
        label: "Tag focus as a profile",
        pluginName: "focus",
      },
    });

    const tagged = getPluginByName("focus");
    expect(tagged && isProfilePlugin(tagged)).toBe(true);
  });

  it("rejects sync-install without a marketplace or catalog source", async () => {
    const root = createPlugin({ name: "my-setup" });
    addDependency(root.id, "missing-plugin");

    await expect(
      runConstraintRecovery({
        rootName: "my-setup",
        action: {
          id: "sync-install",
          label: "Install or create missing-plugin",
          pluginName: "missing-plugin",
        },
      }),
    ).rejects.toThrow(
      "Automated sync-install is only supported for marketplace and catalog dependencies",
    );
    await expect(
      runConstraintRecovery({
        rootName: "my-setup",
        action: {
          id: "sync-install",
          label: "Install or create missing-plugin",
          pluginName: "missing-plugin",
        },
      }),
    ).rejects.toThrow("ht plugin create missing-plugin");
  });

  it("errors when marketplace sync-install has no matching pin", async () => {
    const root = createPlugin({ name: "Teads (Default)" });

    await expect(
      runConstraintRecovery({
        rootName: "Teads (Default)",
        action: {
          id: "sync-install",
          label: "Sync marketplace plugins (install design-doc)",
          pluginName: "design-doc",
          sourceKind: "marketplace",
        },
      }),
    ).rejects.toThrow("No marketplace pin for design-doc on Teads (Default)");
  });

  it("syncs marketplace pins matching the plugin name", async () => {
    const root = createPlugin({ name: "Teads (Default)" });
    addDependency(root.id, "design-doc@anthropics", { versionConstraint: "*" });

    const syncSpy = spyOn(pluginPinApply, "syncPluginPinsForApply").mockResolvedValue({
      installs: [],
      syncedResourceCount: 0,
      unresolvedPins: [],
    });
    try {
      await runConstraintRecovery({
        rootName: "Teads (Default)",
        projectRoot: ctx.projectDir,
        action: {
          id: "sync-install",
          label: "Sync marketplace plugins (install design-doc)",
          pluginName: "design-doc",
          sourceKind: "marketplace",
        },
      });

      expect(syncSpy).toHaveBeenCalledWith({
        pins: [{ ref: "design-doc@anthropics", version_constraint: "*" }],
        syncAll: true,
        projectRoot: ctx.projectDir,
      });
    } finally {
      syncSpy.mockRestore();
    }
  });

  it("errors when marketplace sync leaves pins unresolved", async () => {
    const root = createPlugin({ name: "Teads (Default)" });
    addDependency(root.id, "design-doc@teads-plugins", { versionConstraint: "*" });

    const syncSpy = spyOn(pluginPinApply, "syncPluginPinsForApply").mockResolvedValue({
      installs: [],
      syncedResourceCount: 0,
      unresolvedPins: ["design-doc@teads-plugins"],
    });
    try {
      await expect(
        runConstraintRecovery({
          rootName: "Teads (Default)",
          projectRoot: ctx.projectDir,
          action: {
            id: "sync-install",
            label: "Sync marketplace plugins (install design-doc)",
            pluginName: "design-doc",
            sourceKind: "marketplace",
          },
        }),
      ).rejects.toThrow(/Could not sync design-doc@teads-plugins from marketplace/);
      await expect(
        runConstraintRecovery({
          rootName: "Teads (Default)",
          projectRoot: ctx.projectDir,
          action: {
            id: "sync-install",
            label: "Sync marketplace plugins (install design-doc)",
            pluginName: "design-doc",
            sourceKind: "marketplace",
          },
        }),
      ).rejects.toThrow(/Install or update the plugin in Claude Code/);
    } finally {
      syncSpy.mockRestore();
    }
  });

  it("errors when marketplace install reports failure", async () => {
    const root = createPlugin({ name: "Teads (Default)" });
    addDependency(root.id, "design-doc@teads-plugins", { versionConstraint: "*" });

    const syncSpy = spyOn(pluginPinApply, "syncPluginPinsForApply").mockResolvedValue({
      installs: [
        {
          ref: "design-doc@teads-plugins",
          platformId: "claude-code",
          scope: "user",
          status: "failed",
          message: "marketplace not registered",
        },
      ],
      syncedResourceCount: 0,
      unresolvedPins: [],
    });
    try {
      await expect(
        runConstraintRecovery({
          rootName: "Teads (Default)",
          projectRoot: ctx.projectDir,
          action: {
            id: "sync-install",
            label: "Sync marketplace plugins (install design-doc)",
            pluginName: "design-doc",
            sourceKind: "marketplace",
          },
        }),
      ).rejects.toThrow(/Could not install design-doc from marketplace/);
      await expect(
        runConstraintRecovery({
          rootName: "Teads (Default)",
          projectRoot: ctx.projectDir,
          action: {
            id: "sync-install",
            label: "Sync marketplace plugins (install design-doc)",
            pluginName: "design-doc",
            sourceKind: "marketplace",
          },
        }),
      ).rejects.toThrow(/marketplace not registered/);
    } finally {
      syncSpy.mockRestore();
    }
  });
});
