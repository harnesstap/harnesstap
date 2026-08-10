import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import { listDependencies } from "../../src/services/plugin-dependency.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("surface-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("ht plugin command surface", () => {
  it("exposes every former layer subcommand under plugin", async () => {
    const result = await runCli(["plugin", "--help"]);
    for (const sub of [
      "create",
      "list",
      "show",
      "edit",
      "cut",
      "publish",
      "pull",
      "fork",
      "doctor",
      "why",
      "search",
      "add",
      "delete",
      "diff",
      "from-project",
    ]) {
      expect(result.stdout).toContain(sub);
    }
  });

  it("no longer exposes plugin apply", async () => {
    const result = await runCli(["plugin", "--help"]);
    expect(result.stdout).not.toContain("plugin apply");
  });

  it("adds a dependency with plugin add --to", async () => {
    createPlugin({ name: "base" });
    const root = createPlugin({ name: "root" });
    const result = await runCli(["plugin", "add", "base", "--to", "root"]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(listDependencies(root.id).map((d) => d.name)).toEqual(["base"]);
  });

  it("keeps ht layer working as a hidden deprecated alias", async () => {
    createPlugin({ name: "base" });
    const result = await runCli(["layer", "list"]);
    expect(result.exitCode ?? 0).toBe(0);
    // ui.warn uses console.log → captured as stdout by runCli
    expect(result.stdout).toContain("ht layer is now ht plugin");
  });

  it("hides the layer alias from top-level help", async () => {
    const result = await runCli(["--help"]);
    expect(result.stdout).toContain("plugin");
    expect(result.stdout).not.toMatch(/^\s+layer\b/m);
  });
});
