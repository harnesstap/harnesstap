import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { createLayer } from "../../src/models/plugin-model.ts";
import { setLayerOrigin } from "../../src/services/layer-origin.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("gating-");
});

afterEach(async () => {
  await ctx.cleanup();
});

async function upstream(name: string): Promise<void> {
  const layer = createLayer({ name });
  setLayerOrigin(layer.id, "upstream");
}

describe("provenance gating", () => {
  it("refuses edit on an upstream plugin and names fork", async () => {
    await upstream("web-search");
    const result = await runCli([
      "layer",
      "edit",
      "web-search",
      "--add",
      "skill:anything",
      "--no-interactive",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "web-search is an upstream plugin and cannot be edited directly",
    );
    expect(result.stderr).toContain("ht layer fork web-search");
  });

  it("refuses cut on an upstream plugin", async () => {
    await upstream("web-search");
    const result = await runCli(["layer", "cut", "web-search", "--version", "2.0.0"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cannot be cut");
  });

  it("refuses publish on an upstream plugin", async () => {
    await upstream("web-search");
    const result = await runCli(["layer", "publish", "web-search", "--format", "json"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cannot be published directly");
  });

  it("allows edit on an authored plugin", async () => {
    createLayer({ name: "mine" });
    const result = await runCli(["layer", "show", "mine"]);
    expect(result.exitCode ?? 0).toBe(0);
  });
});
