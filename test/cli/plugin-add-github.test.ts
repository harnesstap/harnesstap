import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("plugin-add-github-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("ht plugin add GitHub import", () => {
  it("documents GitHub library import in help", async () => {
    const result = await runCli(["plugin", "add", "--help"]);
    expect(result.stdout).toContain("owner/repo");
    expect(result.stdout).toContain("gh:owner/repo");
    expect(result.stdout).toContain("--to");
  });

  it("still requires --to for marketplace refs", async () => {
    const add = await runCli(["plugin", "add", "alpha@local-market", "--format", "json"], {
      isTTY: false,
    });
    expect(add.exitCode).toBe(2);
    expect(add.stderr).toContain("Pass --to");
  });
});
