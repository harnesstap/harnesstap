import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import { createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { addMarketplace, updateMarketplace } from "../../src/services/marketplace-registry.ts";
import { importPluginFromMarketplace } from "../../src/services/plugin-marketplace-import.ts";
import { CriticalUnicodeError } from "../../src/services/unicode-scan.ts";
import { gateDeployFiles } from "../../src/services/deploy-gate.ts";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";

const LRE = "\u202A";
// The shape of claude-mem's sanitizer: a bidi control inside a regex character class.
const PROGRAM = `const sanitize = (s) => s.replace(/[${LRE}\\u200E]/g, "");\nmodule.exports = { sanitize };\n`;

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("apply-project-plugin-unicode-");
});

afterEach(async () => {
  await ctx.cleanup();
});

/** Marketplace repo `mkta` with plugin `dup`: a skill, a hook config, a .cjs program file. */
function initMarketplace(skillText: string): string {
  const repo = join(ctx.rootDir, "mkta");
  const plugin = join(repo, "plugins/dup");
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
  mkdirSync(join(plugin, "skills/dup-skill"), { recursive: true });
  mkdirSync(join(plugin, "scripts"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin/marketplace.json"),
    JSON.stringify({ name: "mkta", owner: { name: "qa" }, plugins: [{ name: "dup", source: "./plugins/dup", description: "dup" }] }),
  );
  writeFileSync(join(plugin, ".claude-plugin/plugin.json"), JSON.stringify({ name: "dup", version: "1.0.0" }));
  writeFileSync(join(plugin, "skills/dup-skill/SKILL.md"), skillText);
  writeFileSync(join(plugin, "scripts/worker.cjs"), PROGRAM);
  spawnSync("git", ["init", "-q"], { cwd: repo });
  spawnSync("git", ["add", "-A"], { cwd: repo });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: repo });
  return repo;
}

async function setupProfile(skillText: string): Promise<void> {
  addMarketplace(getHarnesstapDir(), { url: initMarketplace(skillText), name: "mkta", platforms: ["claude-code"] });
  await importPluginFromMarketplace({ marketplace: "mkta", plugin: "dup" });
  const profile = createPlugin({ name: "remote" });
  setPluginTags(profile.id, ["profile"]);
  addDependency(profile.id, "dup@mkta");
  updateMarketplace(getHarnesstapDir(), "mkta", { url: "https://example.invalid/qa/mkta.git" });
}

async function applyProject(): Promise<{ exitCode?: number; stderr: string; project: string }> {
  const project = join(ctx.rootDir, "project");
  mkdirSync(project, { recursive: true });
  const result = await runCli(
    ["apply", "remote", "--project", project, "--harness", "claude-code", "--yes", "--on-conflict", "replace"],
    { env: { HOME: ctx.homeDir, HARNESSTAP_HOME: getHarnesstapDir() } },
  );
  return { exitCode: result.exitCode, stderr: `${result.stdout}\n${result.stderr}`, project };
}

describe("apply --project hidden-Unicode gate on remote plugin trees", () => {
  it("does not block on a bidi control in a plugin program file", async () => {
    await setupProfile("---\nname: dup-skill\ndescription: dup\n---\ndup\n");
    const { exitCode, stderr, project } = await applyProject();
    expect(stderr).not.toContain("Critical hidden Unicode");
    expect(stderr).toContain("worker.cjs:1:");
    expect(exitCode ?? 0).toBe(0);
    expect(existsSync(join(project, ".claude/plugins/cache/mkta/dup"))).toBe(true);
  });

  it("still blocks a bidi control in a plugin SKILL.md", async () => {
    await setupProfile(`---\nname: dup-skill\ndescription: dup\n---\ndup${LRE}\n`);
    const { exitCode, stderr, project } = await applyProject();
    expect(stderr).toContain("Critical hidden Unicode");
    expect(stderr).toContain("SKILL.md");
    expect(exitCode).toBe(1);
    expect(existsSync(join(project, ".claude/plugins/cache/mkta/dup/skills/dup-skill/SKILL.md"))).toBe(false);
  });
});

describe("deploy gate and plugin program files", () => {
  const cache = ".claude/plugins/cache/mkta/dup/1.0.0";
  const hidden = `x${LRE}y\n`;

  it("reports program files under the plugin cache as warnings", () => {
    for (const name of ["scripts/a.cjs", "scripts/a.js", "lib/a.ts", "hooks/run.sh", "tools/a.py"]) {
      const { findings } = gateDeployFiles([{ path: `${cache}/${name}`, content: hidden }]);
      expect(findings.map((finding) => finding.severity)).toEqual(["warning"]);
    }
  });

  it("blocks the files a model or Claude Code reads, and program files outside the plugin cache", () => {
    for (const path of [
      `${cache}/skills/dup-skill/SKILL.md`,
      `${cache}/commands/run.md`,
      `${cache}/agents/helper.md`,
      `${cache}/hooks/hooks.json`,
      `${cache}/.mcp.json`,
      `${cache}/.claude-plugin/plugin.json`,
      ".claude/hooks/run.sh",
      "scripts/a.cjs",
    ]) {
      expect(() => gateDeployFiles([{ path, content: hidden }])).toThrow(CriticalUnicodeError);
    }
  });
});
