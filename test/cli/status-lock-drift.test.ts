import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { createLayer, getLayerByName } from "../../src/models/layer-model.ts";
import { addLayerAttachment } from "../../src/services/layer-composition.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("lockdrift-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("status lock drift", () => {
  it("reports no drift right after apply", async () => {
    createLayer({ name: "base", version: "1.0.0" });
    createLayer({ name: "root", version: "1.0.0" });
    const root = getLayerByName("root");
    if (!root) throw new Error("missing root");
    await addLayerAttachment({ layer: root, selector: "layer:base" });
    await runCli(["layer", "apply", "root", "--project", ctx.projectDir, "--harness", "claude-code"]);

    const result = await runCli([
      "status",
      ctx.projectDir,
      "--format",
      "json",
    ]);
    const payload = JSON.parse(result.stdout) as { lock?: { drift: boolean } };
    expect(payload.lock?.drift).toBe(false);
  });

  it("reports drift when a newer dependency version appears", async () => {
    createLayer({ name: "base", version: "1.0.0" });
    createLayer({ name: "root", version: "1.0.0" });
    const root = getLayerByName("root");
    if (!root) throw new Error("missing root");
    await addLayerAttachment({ layer: root, selector: "layer:base" });
    await runCli(["layer", "apply", "root", "--project", ctx.projectDir, "--harness", "claude-code"]);

    createLayer({ name: "base", version: "1.1.0" });

    const result = await runCli([
      "status",
      ctx.projectDir,
      "--format",
      "json",
    ]);
    const payload = JSON.parse(result.stdout) as {
      lock?: { drift: boolean; changes: Array<{ name: string; locked: string; resolved: string }> };
    };
    expect(payload.lock?.drift).toBe(true);
    expect(payload.lock?.changes).toContainEqual({
      name: "base",
      locked: "1.0.0",
      resolved: "1.1.0",
    });
  });
});
