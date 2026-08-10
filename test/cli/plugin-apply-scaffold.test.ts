import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { addResourceToPlugin, createPlugin, getPluginByName } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { addPluginAttachment } from "../../src/services/plugin-composition.ts";
import { getPluginOverrides } from "../../src/services/plugin-overrides.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("scaffold-cli-");
});

afterEach(async () => {
  await ctx.cleanup();
});

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

/**
 * Ephemeral `apply a b` uses declarationOrderSingletons, so equal-depth
 * instruction conflicts last-win and never throw. Seed a durable root that
 * depends on both sides (diamond) so SingletonConflictError still fires.
 */
async function seedDiamondConflict(): Promise<void> {
  const a = createPlugin({ name: "a" });
  attachInstruction(a.id, "FROM-A", "a");
  const b = createPlugin({ name: "b" });
  attachInstruction(b.id, "FROM-B", "b");
  createPlugin({ name: "root" });
  const rootPlugin = getPluginByName("root");
  if (!rootPlugin) throw new Error("missing root");
  await addPluginAttachment({ plugin: rootPlugin, selector: "plugin:a" });
  await addPluginAttachment({ plugin: rootPlugin, selector: "plugin:b" });
}

describe("apply conflict scaffolding", () => {
  it("offers to promote the composition and re-applies cleanly", async () => {
    await seedDiamondConflict();

    const result = await runCli(
      ["apply", "root", "--project", ctx.projectDir, "--harness", "claude-code"],
      {
        isTTY: true,
        promptResponses: [
          { value: true },
          { value: "my-setup" },
          { value: "b" },
        ],
      },
    );

    expect(result.exitCode ?? 0).toBe(0);
    const created = getPluginByName("my-setup");
    expect(created).toBeDefined();
    if (!created) return;
    expect(getPluginOverrides(created.id).resources["instruction:context"]).toBe("b");
  });

  it("fails without scaffolding on a non-TTY run", async () => {
    await seedDiamondConflict();

    const result = await runCli([
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
      "--no-interactive",
    ]);
    expect(result.exitCode ?? 0).toBe(1);
    expect(getPluginByName("my-setup")).toBeUndefined();
  });
});
