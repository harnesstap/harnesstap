import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";
import { attachPluginPinToPlugin } from "../../src/services/plugin-composition.ts";
import { addMarketplace } from "../../src/services/marketplace-registry.ts";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("apply-ignore-inexact-");
});

afterEach(async () => {
  await ctx.cleanup();
});

/** Marketplace repo `mkta` with plugin `dup` 1.0.0 (one skill), not installed anywhere yet. */
function initMarketplace(): string {
  const repo = join(ctx.rootDir, "mkta");
  const plugin = join(repo, "plugins/dup");
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
  mkdirSync(join(plugin, "skills/dup-skill"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin/marketplace.json"),
    JSON.stringify({ name: "mkta", owner: { name: "qa" }, plugins: [{ name: "dup", source: "./plugins/dup", description: "dup" }] }),
  );
  writeFileSync(join(plugin, ".claude-plugin/plugin.json"), JSON.stringify({ name: "dup", version: "1.0.0" }));
  writeFileSync(join(plugin, "skills/dup-skill/SKILL.md"), "---\nname: dup-skill\ndescription: dup\n---\ndup\n");
  spawnSync("git", ["init", "-q"], { cwd: repo });
  spawnSync("git", ["add", "-A"], { cwd: repo });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: repo });
  return repo;
}

async function applyIgnoringVersions(constraint: string): Promise<{ exitCode?: number; output: string }> {
  addMarketplace(getHarnesstapDir(), { url: initMarketplace(), name: "mkta", platforms: ["claude-code"] });
  const root = createPlugin({ name: "root" });
  attachPluginPinToPlugin(root.id, "dup@mkta", constraint);
  const project = join(ctx.rootDir, "project");
  mkdirSync(project, { recursive: true });
  const result = await runCli(
    ["apply", "root", "--project", project, "--harness", "claude-code", "--ignore-plugin-versions", "--yes"],
    { env: { HOME: ctx.homeDir, HARNESSTAP_HOME: getHarnesstapDir() } },
  );
  return { exitCode: result.exitCode, output: `${result.stdout}\n${result.stderr}` };
}

describe("apply --ignore-plugin-versions with a plugin that is not installed", () => {
  it("installs and resolves a `*` dependency instead of failing", async () => {
    const { exitCode, output } = await applyIgnoringVersions("*");
    expect(output).not.toContain("No local version of");
    expect(exitCode ?? 0).toBe(0);
    expect(existsSync(join(ctx.homeDir, ".claude/plugins/cache/mkta/dup/1.0.0"))).toBe(true);
  });

  it("installs and resolves a range dependency instead of failing", async () => {
    const { exitCode, output } = await applyIgnoringVersions(">=1.0.0 <2.0.0");
    expect(output).not.toContain("No local version of");
    expect(exitCode ?? 0).toBe(0);
  });

  it("still skips the host install for an exact dependency", async () => {
    const { exitCode } = await applyIgnoringVersions("1.0.0");
    expect(exitCode ?? 0).toBe(0);
    expect(existsSync(join(ctx.homeDir, ".claude/plugins/cache/mkta/dup"))).toBe(false);
  });
});
