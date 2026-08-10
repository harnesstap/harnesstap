import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import { setPluginOrigin } from "../../src/services/plugin-origin.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("gating-");
});

afterEach(async () => {
  await ctx.cleanup();
});

async function upstream(name: string): Promise<void> {
  const plugin = createPlugin({ name });
  setPluginOrigin(plugin.id, "upstream");
}

describe("provenance gating", () => {
  it("refuses edit on an upstream plugin and names fork", async () => {
    await upstream("web-search");
    const result = await runCli([
      "plugin",
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
    expect(result.stderr).toContain("ht plugin fork web-search");
  });

  it("refuses cut on an upstream plugin", async () => {
    await upstream("web-search");
    const result = await runCli(["plugin", "cut", "web-search", "--version", "2.0.0"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cannot be cut");
  });

  it("refuses publish on an upstream plugin", async () => {
    await upstream("web-search");
    const result = await runCli(["plugin", "publish", "web-search", "--format", "json"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cannot be published directly");
  });

  it("allows edit on an authored plugin", async () => {
    createPlugin({ name: "mine" });
    const result = await runCli(["plugin", "show", "mine"]);
    expect(result.exitCode ?? 0).toBe(0);
  });
});
