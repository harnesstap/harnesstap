import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../../helpers/db.ts";
import type { TestContext } from "../../helpers/db.ts";
import { addResourceToPlugin, createPlugin } from "../../../src/models/plugin-model.ts";
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
  pluginId: string,
  name: string,
  depth: number,
  declarationIndex: number,
): SelectedPlugin {
  return {
    name,
    version: "1.0.0",
    pluginId,
    depth,
    declarationIndex,
    constraints: [],
    reason: depth === 0 ? "root" : "mediation",
    path: [],
    source: "local",
  };
}

function attach(
  pluginId: string,
  input: {
    type: "skill" | "instruction";
    name: string;
    content: string;
    namespace?: string;
    source?: string;
  },
): ReturnType<typeof createResource> {
  const resource = createResource({
    type: input.type,
    name: input.name,
    description: "",
    content: input.content,
    metadata: {},
    source: input.source ?? "test",
    ...(input.namespace ? { namespace: input.namespace } : {}),
  });
  addResourceToPlugin(pluginId, resource.id);
  return resource;
}

describe("resolveResources", () => {
  it("materializes distinct keys from every selected plugin", () => {
    const root = createPlugin({ name: "root" });
    const dep = createPlugin({ name: "dep" });
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
    const root = createPlugin({ name: "root" });
    const dep = createPlugin({ name: "dep" });
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
    expect(decision?.winner.pluginName).toBe("root");
    expect(decision?.losers[0]?.pluginName).toBe("dep");
    expect(result.warnings).toEqual([]);
  });

  it("treats identical content at equal depth as a no-op", () => {
    const a = createPlugin({ name: "a" });
    const b = createPlugin({ name: "b" });
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
    const a = createPlugin({ name: "a" });
    const b = createPlugin({ name: "b" });
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
    const a = createPlugin({ name: "a" });
    const b = createPlugin({ name: "b" });
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
    const a = createPlugin({ name: "a" });
    const b = createPlugin({ name: "b" });
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

  it("distinguishes same-plugin singleton copies by source and hash", () => {
    const profile = createPlugin({ name: "global default" });
    const agents = attach(profile.id, {
      type: "instruction",
      name: "agents-instructions",
      content: "# AGENTS",
      source: "AGENTS.md",
      namespace: "agents",
    });
    const claude = attach(profile.id, {
      type: "instruction",
      name: "agents-instructions",
      content: "# CLAUDE",
      source: "CLAUDE.md",
      namespace: "claude",
    });

    let caught: unknown;
    try {
      resolveResources({
        selected: [selection(profile.id, "global default", 0, 0)],
        overrides: { versions: {}, resources: {} },
        rootName: "global default",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SingletonConflictError);
    const error = caught as SingletonConflictError;
    const labels = error.actions.map((action) => action.label);
    expect(new Set(labels).size).toBe(2);
    expect(labels[0]).toContain("AGENTS.md");
    expect(labels[1]).toContain("CLAUDE.md");
    expect(error.actions[0]?.preview).toContain("# AGENTS");
    expect(error.actions[1]?.preview).toContain("# CLAUDE");
    expect(error.actions[0]?.winnerResourceId).toBe(agents.id);
    expect(error.actions[1]?.winnerResourceId).toBe(claude.id);
    expect(error.message).toContain("AGENTS.md");
    expect(error.message).toContain("CLAUDE.md");
  });

  it("honors a resource-id override when one plugin has two copies", () => {
    const profile = createPlugin({ name: "global default" });
    attach(profile.id, {
      type: "instruction",
      name: "agents-instructions",
      content: "# AGENTS",
      source: "AGENTS.md",
      namespace: "agents",
    });
    const claude = attach(profile.id, {
      type: "instruction",
      name: "agents-instructions",
      content: "# CLAUDE",
      source: "CLAUDE.md",
      namespace: "claude",
    });

    const result = resolveResources({
      selected: [selection(profile.id, "global default", 0, 0)],
      overrides: {
        versions: {},
        resources: { "instruction:agents-instructions": claude.id },
      },
      rootName: "global default",
    });

    expect(result.resources[0]?.content).toBe("# CLAUDE");
    expect(result.decisions[0]?.reason).toBe("root-override");
  });

  it("collapses identical fingerprints before offering a singleton choice", () => {
    const profile = createPlugin({ name: "global default" });
    attach(profile.id, {
      type: "instruction",
      name: "agents-instructions",
      content: "# SAME",
      source: "AGENTS.md",
      namespace: "agents",
    });
    attach(profile.id, {
      type: "instruction",
      name: "agents-instructions",
      content: "# SAME",
      source: "CLAUDE.md",
      namespace: "claude",
    });

    const result = resolveResources({
      selected: [selection(profile.id, "global default", 0, 0)],
      overrides: { versions: {}, resources: {} },
      rootName: "global default",
    });

    expect(result.decisions[0]?.reason).toBe("identical-content");
    expect(result.resources[0]?.content).toBe("# SAME");
  });

  it("honors a root resource override over depth", () => {
    const root = createPlugin({ name: "root" });
    const dep = createPlugin({ name: "dep" });
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
