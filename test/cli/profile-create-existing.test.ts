import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createPlugin, listPlugins } from "../../src/models/plugin-model.ts";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("profile-create-existing-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function rowsNamed(name: string) {
  return listPlugins().filter((plugin) => plugin.name === name);
}

describe("profile create on an existing plugin", () => {
  it("tags a plugin at a non-default version instead of adding an empty twin", async () => {
    createPlugin({ name: "backend-cli-fork", version: "0.3.0", description: "Forked persona" });

    const result = await runCli(["profile", "create", "backend-cli-fork"]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toContain("Tagged plugin backend-cli-fork as profile");

    const rows = rowsNamed("backend-cli-fork");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe("0.3.0");
    expect(rows[0]?.tags).toContain("profile");

    const list = await runCli(["profile", "list"]);
    expect(list.stdout).toContain("backend-cli-fork");
    expect(list.stdout).toContain("0.3.0");
  });

  it("reports an existing profile without creating anything", async () => {
    createPlugin({ name: "work", version: "2.0.0", tags: ["profile"] });
    const result = await runCli(["profile", "create", "work"]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toContain("Profile work already exists");
    expect(rowsNamed("work")).toHaveLength(1);
  });

  it("refuses --version when the plugin exists at another version", async () => {
    createPlugin({ name: "backend-cli-fork", version: "0.3.0" });
    const result = await runCli(["profile", "create", "backend-cli-fork", "--version", "1.0.0"]);
    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "Plugin backend-cli-fork already exists at version 0.3.0",
    );
    expect(rowsNamed("backend-cli-fork")).toHaveLength(1);
  });

  it("still creates a new profile when the name is free", async () => {
    const result = await runCli(["profile", "create", "fresh"]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(rowsNamed("fresh").map((plugin) => plugin.version)).toEqual(["1.0.0"]);
  });
});
