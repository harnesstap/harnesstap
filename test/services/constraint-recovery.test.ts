import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import {
  addResourceToPlugin,
  createPlugin,
} from "../../src/models/plugin-model.ts";
import { ensurePluginResource } from "../../src/services/plugin-composition.ts";
import {
  getPluginOverrides,
  setPluginVersionOverride,
  clearPluginVersionOverride,
} from "../../src/services/plugin-overrides.ts";
import { listDependencies } from "../../src/services/plugin-dependency.ts";
import { runConstraintRecovery } from "../../src/services/constraint-recovery.ts";

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
});
