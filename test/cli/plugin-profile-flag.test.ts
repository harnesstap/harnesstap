import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("plugin-profile-flag-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("plugin create/edit --profile", () => {
  it("tags a created plugin as a profile", async () => {
    const created = await runCli(["plugin", "create", "work", "--profile"]);
    expect(created.exitCode ?? 0).toBe(0);

    const listed = await runCli(["profile", "list", "--local-only"]);
    expect(listed.exitCode ?? 0).toBe(0);
    expect(listed.stdout).toContain("work");
  });

  it("adds and removes the profile tag via edit flags", async () => {
    const created = await runCli(["plugin", "create", "stack"]);
    expect(created.exitCode ?? 0).toBe(0);

    const before = await runCli(["profile", "list", "--local-only"]);
    expect(before.stdout).not.toContain("stack");

    const tagged = await runCli(["plugin", "edit", "stack", "--profile"]);
    expect(tagged.exitCode ?? 0).toBe(0);

    const listed = await runCli(["profile", "list", "--local-only"]);
    expect(listed.stdout).toContain("stack");

    const untagged = await runCli(["plugin", "edit", "stack", "--no-profile"]);
    expect(untagged.exitCode ?? 0).toBe(0);

    const after = await runCli(["profile", "list", "--local-only"]);
    expect(after.stdout).not.toContain("stack");
  });
});
