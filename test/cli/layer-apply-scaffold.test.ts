import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { addResourceToLayer, createLayer, getLayerByName } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { addLayerAttachment } from "../../src/services/layer-composition.ts";
import { getLayerOverrides } from "../../src/services/layer-overrides.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("scaffold-cli-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function attachInstruction(layerId: string, content: string, ns: string): void {
  const resource = createResource({
    type: "instruction",
    name: "context",
    description: "",
    content,
    metadata: {},
    source: "test",
    namespace: ns,
  });
  addResourceToLayer(layerId, resource.id);
}

/**
 * Ephemeral `apply a b` uses declarationOrderSingletons, so equal-depth
 * instruction conflicts last-win and never throw. Seed a durable root that
 * depends on both sides (diamond) so SingletonConflictError still fires.
 */
async function seedDiamondConflict(): Promise<void> {
  const a = createLayer({ name: "a" });
  attachInstruction(a.id, "FROM-A", "a");
  const b = createLayer({ name: "b" });
  attachInstruction(b.id, "FROM-B", "b");
  createLayer({ name: "root" });
  const rootLayer = getLayerByName("root");
  if (!rootLayer) throw new Error("missing root");
  await addLayerAttachment({ layer: rootLayer, selector: "layer:a" });
  await addLayerAttachment({ layer: rootLayer, selector: "layer:b" });
}

describe("apply conflict scaffolding", () => {
  it("offers to promote the composition and re-applies cleanly", async () => {
    await seedDiamondConflict();

    const result = await runCli(
      ["layer", "apply", "root", "--project", ctx.projectDir, "--harness", "claude-code"],
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
    const created = getLayerByName("my-setup");
    expect(created).toBeDefined();
    if (!created) return;
    expect(getLayerOverrides(created.id).resources["instruction:context"]).toBe("b");
  });

  it("fails without scaffolding on a non-TTY run", async () => {
    await seedDiamondConflict();

    const result = await runCli([
      "layer",
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
      "--no-interactive",
    ]);
    expect(result.exitCode ?? 0).toBe(1);
    expect(getLayerByName("my-setup")).toBeUndefined();
  });
});
