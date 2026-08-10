import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { createPlugin, getPluginByName } from "../../src/models/plugin-model.ts";
import { getPluginOverrides } from "../../src/services/plugin-overrides.ts";
import { listAttachedPluginRefs } from "../../src/services/plugin-composition.ts";
import { scaffoldCompositionPlugin } from "../../src/services/resolve-conflict-scaffold.ts";
import { SingletonConflictError } from "../../src/services/resolve/types.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("scaffold-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("scaffoldCompositionPlugin", () => {
  it("creates a real plugin whose dependencies are the attempted composition", async () => {
    createPlugin({ name: "a", version: "1.0.0" });
    createPlugin({ name: "b", version: "1.0.0" });

    const created = await scaffoldCompositionPlugin({
      name: "my-setup",
      dependencies: ["a", "b"],
      resourceOverrides: { "instruction:context": "b" },
      versionOverrides: {},
    });

    const plugin = getPluginByName("my-setup");
    expect(plugin?.id).toBe(created.id);
    expect(
      listAttachedPluginRefs(created.id).map((ref) => ref.dependency_name).sort(),
    ).toEqual(["a", "b"]);
    expect(getPluginOverrides(created.id).resources).toEqual({
      "instruction:context": "b",
    });
  });

  it("derives override choices from a singleton conflict", () => {
    const error = new SingletonConflictError({
      key: "instruction:context",
      sides: [
        { pluginName: "a", pluginVersion: "1.0.0", depth: 1 },
        { pluginName: "b", pluginVersion: "1.0.0", depth: 1 },
      ],
      rootName: "my-setup",
    });
    expect(error.hints).toEqual([
      "ht plugin edit my-setup --override instruction:context=a",
      "ht plugin edit my-setup --override instruction:context=b",
    ]);
  });

  it("refuses to overwrite an existing plugin name", async () => {
    createPlugin({ name: "a", version: "1.0.0" });
    createPlugin({ name: "taken", version: "1.0.0" });
    await expect(
      scaffoldCompositionPlugin({
        name: "taken",
        dependencies: ["a"],
        resourceOverrides: {},
        versionOverrides: {},
      }),
    ).rejects.toThrow(/already exists/);
  });
});
