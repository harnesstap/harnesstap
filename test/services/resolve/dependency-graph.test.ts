import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../../helpers/db.ts";
import type { TestContext } from "../../helpers/db.ts";
import { createPlugin, getPluginByName } from "../../../src/models/plugin-model.ts";
import { addPluginAttachment } from "../../../src/services/plugin-composition.ts";
import { addDependency } from "../../../src/services/plugin-dependency.ts";
import { walkDependencyGraph } from "../../../src/services/resolve/dependency-graph.ts";
import { UnsatisfiableConstraintError } from "../../../src/services/resolve/types.ts";
import { setPluginVersionOverride } from "../../../src/services/plugin-overrides.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("graph-");
});

afterEach(async () => {
  await ctx.cleanup();
});

async function dependOn(
  parentName: string,
  depName: string,
  version?: string,
): Promise<void> {
  const parent = getPluginByName(parentName);
  if (!parent) throw new Error(`missing plugin ${parentName}`);
  await addPluginAttachment({
    plugin: parent,
    selector: `plugin:${depName}`,
    ...(version ? { version } : {}),
  });
}

describe("walkDependencyGraph", () => {
  it("unifies a diamond to one version satisfying both constraints", async () => {
    createPlugin({ name: "base", version: "1.0.0" });
    createPlugin({ name: "base", version: "2.0.0" });
    createPlugin({ name: "base", version: "2.1.0" });
    createPlugin({ name: "left", version: "1.0.0" });
    createPlugin({ name: "right", version: "1.0.0" });
    const root = createPlugin({ name: "root", version: "1.0.0" });
    await dependOn("left", "base", "^2.0.0");
    await dependOn("right", "base", "<2.1.0");
    await dependOn("root", "left");
    await dependOn("root", "right");

    const walk = walkDependencyGraph({ rootPluginId: root.id });
    const base = walk.selected.find((entry) => entry.name === "base");
    expect(base?.version).toBe("2.0.0");
    expect(base?.depth).toBe(2);
    expect(base?.reason).toBe("mediation");
    expect(base?.constraints).toHaveLength(2);
  });

  it("records the shortest depth when a name is reachable by two paths", async () => {
    createPlugin({ name: "base", version: "1.0.0" });
    createPlugin({ name: "mid", version: "1.0.0" });
    const root = createPlugin({ name: "root", version: "1.0.0" });
    await dependOn("mid", "base");
    await dependOn("root", "mid");
    await dependOn("root", "base");

    const walk = walkDependencyGraph({ rootPluginId: root.id });
    expect(walk.selected.find((entry) => entry.name === "base")?.depth).toBe(1);
  });

  it("lets a root override beat a transitive constraint", async () => {
    createPlugin({ name: "base", version: "1.0.0" });
    createPlugin({ name: "base", version: "2.0.0" });
    createPlugin({ name: "mid", version: "1.0.0" });
    const root = createPlugin({ name: "root", version: "1.0.0" });
    await dependOn("mid", "base", "^2.0.0");
    await dependOn("root", "mid");
    setPluginVersionOverride(root.id, "base", "1.0.0");

    const walk = walkDependencyGraph({ rootPluginId: root.id });
    const base = walk.selected.find((entry) => entry.name === "base");
    expect(base?.version).toBe("1.0.0");
    expect(base?.reason).toBe("root-override");
  });

  it("errors with both requirers when the intersection is empty", async () => {
    createPlugin({ name: "base", version: "1.4.0" });
    createPlugin({ name: "base", version: "2.1.0" });
    createPlugin({ name: "team-standards", version: "2.1.0" });
    createPlugin({ name: "legacy-review", version: "1.4.0" });
    const root = createPlugin({ name: "my-setup", version: "1.0.0" });
    await dependOn("team-standards", "base", "^2.0.0");
    await dependOn("legacy-review", "base", "^1.2.0");
    await dependOn("my-setup", "team-standards");
    await dependOn("my-setup", "legacy-review");

    expect(() => walkDependencyGraph({ rootPluginId: root.id })).toThrow(
      UnsatisfiableConstraintError,
    );
  });

  it("terminates on a dependency cycle", async () => {
    createPlugin({ name: "a", version: "1.0.0" });
    createPlugin({ name: "b", version: "1.0.0" });
    const root = createPlugin({ name: "root", version: "1.0.0" });
    await dependOn("a", "b");
    await dependOn("b", "a");
    await dependOn("root", "a");

    const walk = walkDependencyGraph({ rootPluginId: root.id });
    expect(walk.selected.map((entry) => entry.name).sort()).toEqual([
      "a",
      "b",
      "root",
    ]);
  });

  it("selects a git SHA marketplace install when that is the only local version", async () => {
    createPlugin({ name: "design-doc", version: "4a4211102f36" });
    const root = createPlugin({ name: "Teads (Default)", version: "1.0.1" });
    addDependency(root.id, "design-doc@teads-plugins", { versionConstraint: "*" });

    const walk = walkDependencyGraph({ rootPluginId: root.id });
    const selected = walk.selected.find((entry) => entry.name === "design-doc");
    expect(selected?.version).toBe("4a4211102f36");
    expect(selected?.source).toBe("marketplace");
  });

  it("assigns declaration indexes in first-encounter order", async () => {
    createPlugin({ name: "a", version: "1.0.0" });
    createPlugin({ name: "b", version: "1.0.0" });
    const root = createPlugin({ name: "root", version: "1.0.0" });
    await dependOn("root", "a");
    await dependOn("root", "b");

    const walk = walkDependencyGraph({ rootPluginId: root.id });
    const byName = new Map(walk.selected.map((e) => [e.name, e.declarationIndex]));
    expect(byName.get("root")).toBe(0);
    expect(byName.get("a")).toBe(1);
    expect(byName.get("b")).toBe(2);
  });
});
