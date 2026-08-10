import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../../helpers/db.ts";
import type { TestContext } from "../../helpers/db.ts";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
} from "../../../src/models/plugin-model.ts";
import { createResource } from "../../../src/models/resource.ts";
import { addPluginAttachment } from "../../../src/services/plugin-composition.ts";
import { resolveComposition } from "../../../src/services/resolve/index.ts";
import { SingletonConflictError } from "../../../src/services/resolve/types.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("compose-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function attachSkill(pluginId: string, name: string, content: string, ns: string): void {
  const resource = createResource({
    type: "skill",
    name,
    description: "",
    content,
    metadata: {},
    source: "test",
    namespace: ns,
  });
  addResourceToPlugin(pluginId, resource.id);
}

function attachInstruction(pluginId: string, content: string, ns: string): void {
  const resource = createResource({
    type: "instruction",
    name: "context",
    description: "",
    content,
    metadata: {},
    source: "test",
    namespace: ns,
  });
  addResourceToPlugin(pluginId, resource.id);
}

describe("resolveComposition", () => {
  it("resolves a single named root", async () => {
    const base = createPlugin({ name: "base" });
    const root = createPlugin({ name: "root" });
    attachSkill(base.id, "alpha", "BASE", "base");
    const rootPlugin = getPluginByName("root");
    if (!rootPlugin) throw new Error("missing root");
    await addPluginAttachment({ plugin: rootPlugin, selector: "plugin:base" });

    const result = resolveComposition({ rootSelectors: ["root"] });
    expect(result.root.ephemeral).toBe(false);
    expect(result.root.name).toBe("root");
    expect(result.resources.map((r) => r.name)).toEqual(["alpha"]);
  });

  it("synthesizes an ephemeral root for multiple selectors and keeps last-wins", () => {
    const a = createPlugin({ name: "a" });
    const b = createPlugin({ name: "b" });
    attachSkill(a.id, "alpha", "FROM-A", "a");
    attachSkill(b.id, "alpha", "FROM-B", "b");

    const result = resolveComposition({ rootSelectors: ["a", "b"] });
    expect(result.root.ephemeral).toBe(true);
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.content).toBe("FROM-B");
  });

  it("last-wins conflicting instructions under an ephemeral multi-selector root", () => {
    const a = createPlugin({ name: "a" });
    const b = createPlugin({ name: "b" });
    attachInstruction(a.id, "FROM-A", "a");
    attachInstruction(b.id, "FROM-B", "b");

    const result = resolveComposition({ rootSelectors: ["a", "b"] });
    expect(result.root.ephemeral).toBe(true);
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.content).toBe("FROM-B");
    expect(result.decisions[0]?.reason).toBe("declaration-order");
  });

  it("errors on a durable equal-depth singleton diamond", async () => {
    const a = createPlugin({ name: "a" });
    const b = createPlugin({ name: "b" });
    attachInstruction(a.id, "FROM-A", "a");
    attachInstruction(b.id, "FROM-B", "b");
    const root = createPlugin({ name: "root" });
    const rootPlugin = getPluginByName("root");
    if (!rootPlugin) throw new Error("missing root");
    await addPluginAttachment({ plugin: rootPlugin, selector: "plugin:a" });
    await addPluginAttachment({ plugin: rootPlugin, selector: "plugin:b" });

    expect(() => resolveComposition({ rootSelectors: ["root"] })).toThrow(
      SingletonConflictError,
    );
  });

  it("cleans up the ephemeral root plugin row", () => {
    createPlugin({ name: "a" });
    createPlugin({ name: "b" });
    const result = resolveComposition({ rootSelectors: ["a", "b"] });
    expect(getPluginByName(result.root.name)).toBeUndefined();
  });

  it("rejects an unknown selector", () => {
    expect(() => resolveComposition({ rootSelectors: ["nope"] })).toThrow(
      /Plugin not found: nope/,
    );
  });
});
