import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import {
  addResourceToPlugin,
  createPlugin,
  setPluginTags,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("apply-scope-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function seed(name: string, content: string, profile = false): string {
  const plugin = createPlugin({ name });
  addResourceToPlugin(
    plugin.id,
    createResource({
      type: "instruction",
      name: "context",
      description: "",
      content,
      metadata: {},
      source: "test",
      namespace: name,
    }).id,
  );
  if (profile) setPluginTags(plugin.id, ["profile"]);
  return plugin.id;
}

describe("ht apply", () => {
  it("defaults to project scope and prints the destination first", async () => {
    seed("base", "PROJECT");
    const result = await runCli([
      "apply",
      "base",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
    ]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout.split("\n")[0]).toContain(`→ project ${ctx.projectDir}`);
    expect(readFileSync(join(ctx.projectDir, "CLAUDE.md"), "utf8")).toContain(
      "PROJECT",
    );
  });

  it("prints the destination on a non-TTY run too", async () => {
    seed("base", "PROJECT");
    const result = await runCli(
      ["apply", "base", "--project", ctx.projectDir, "--harness", "claude-code"],
      { isTTY: false },
    );
    expect(result.stdout).toContain("→ project");
  });

  it("includes scope in JSON output", async () => {
    seed("base", "PROJECT");
    const result = await runCli([
      "apply",
      "base",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
      "--format",
      "json",
    ]);
    const payload = JSON.parse(result.stdout) as { scope: string };
    expect(payload.scope).toBe("project");
  });

  it("materializes into home with --global", async () => {
    seed("work", "GLOBAL", true);
    const result = await runCli([
      "apply",
      "work",
      "--global",
      "--harness",
      "claude-code",
    ]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toContain("→ machine home");
    expect(
      readFileSync(join(ctx.homeDir, ".claude", "CLAUDE.md"), "utf8"),
    ).toContain("GLOBAL");
    expect(
      existsSync(join(ctx.homeDir, ".harnesstap", "active-profile.json")),
    ).toBe(true);
  });

  it("warns when --global targets a non-profile plugin and records no active profile", async () => {
    seed("base", "GLOBAL");
    const result = await runCli([
      "apply",
      "base",
      "--global",
      "--harness",
      "claude-code",
    ]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stderr).toContain("no active profile was recorded");
    expect(
      existsSync(join(ctx.homeDir, ".harnesstap", "active-profile.json")),
    ).toBe(false);
  });

  it("does not write a project lockfile on a --global apply", async () => {
    seed("work", "GLOBAL", true);
    await runCli(["apply", "work", "--global", "--harness", "claude-code"]);
    expect(existsSync(join(ctx.projectDir, "apm.lock.yaml"))).toBe(
      false,
    );
  });
});
