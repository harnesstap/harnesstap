import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import { createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { resetAgentApplyInProgressForTests, tryHandle } from "../../src/agent/parity-handlers/apply.ts";
import { attachPluginPinToPlugin, findPluginResourceByPin } from "../../src/services/plugin-composition.ts";
import { addMarketplace } from "../../src/services/marketplace-registry.ts";
import { packagesCacheRoot } from "../../src/services/package-cache/paths.ts";
import type { PluginPinMetadata } from "../../src/types.ts";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";

let ctx: TestContext;
let project: string;

beforeEach(async () => {
  ctx = await createInitializedTestContext("apply-dry-run-inexact-");
  project = join(ctx.rootDir, "project-dry");
  mkdirSync(project, { recursive: true });
});

afterEach(async () => {
  await ctx.cleanup();
});

/** Marketplace repo `mkta` with plugin `dup` (one skill), not installed anywhere. */
function initMarketplace(version: string | null): void {
  const repo = join(ctx.rootDir, "mkta");
  const plugin = join(repo, "plugins/dup");
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
  mkdirSync(join(plugin, "skills/dup-skill"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin/marketplace.json"),
    JSON.stringify({ name: "mkta", owner: { name: "qa" }, plugins: [{ name: "dup", source: "./plugins/dup", description: "dup" }] }),
  );
  writeFileSync(
    join(plugin, ".claude-plugin/plugin.json"),
    JSON.stringify(version ? { name: "dup", version } : { name: "dup" }),
  );
  writeFileSync(join(plugin, "skills/dup-skill/SKILL.md"), "---\nname: dup-skill\ndescription: dup\n---\ndup\n");
  spawnSync("git", ["init", "-q"], { cwd: repo });
  spawnSync("git", ["add", "-A"], { cwd: repo });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: repo });
  addMarketplace(getHarnesstapDir(), { url: repo, name: "mkta", platforms: ["claude-code"] });
}

function setupRoot(constraint: string, version: string | null = "1.0.0"): string {
  initMarketplace(version);
  const root = createPlugin({ name: "root" });
  attachPluginPinToPlugin(root.id, "dup@mkta", constraint);
  return root.id;
}

async function apply(extra: string[]): Promise<{ exitCode: number; output: string }> {
  const result = await runCli(
    ["apply", "root", "--project", project, "--harness", "claude-code,cursor", "--no-interactive", ...extra],
    { env: { HOME: ctx.homeDir, HARNESSTAP_HOME: getHarnesstapDir() } },
  );
  return { exitCode: result.exitCode ?? 0, output: `${result.stdout}\n${result.stderr}` };
}

function listTree(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true }).map(String).sort();
}

/** Everything a dry-run must leave alone: harness config, the project and the plugin cache. */
function userDataSnapshot(): Record<string, string[]> {
  return {
    claude: listTree(join(ctx.homeDir, ".claude")),
    cursor: listTree(join(ctx.homeDir, ".cursor")),
    project: listTree(project),
    packages: listTree(packagesCacheRoot(getHarnesstapDir())),
  };
}

const EMPTY = { claude: [], cursor: [], project: [], packages: [] };

describe("apply --dry-run with an inexact dependency that is not installed", () => {
  for (const strict of [false, true]) {
    const flags = strict ? ["--dry-run", "--strict-plugin-versions"] : ["--dry-run"];
    const label = strict ? " with --strict-plugin-versions" : "";

    it(`plans a \`*\` pin instead of failing${label}`, async () => {
      setupRoot("*");
      const { exitCode, output } = await apply([...flags, "--explain"]);
      expect(output).not.toContain("No local version of");
      expect(output).toContain("would install dup 1.0.0 (dup@mkta)");
      expect(output).toContain("dup@1.0.0");
      expect(exitCode).toBe(0);
      expect(userDataSnapshot()).toEqual(EMPTY);
    });

    it(`plans a range pin instead of failing${label}`, async () => {
      setupRoot(">=1.0.0 <2.0.0");
      const { exitCode, output } = await apply(flags);
      expect(output).not.toContain("No local version of");
      expect(output).toContain("would install dup 1.0.0 (dup@mkta)");
      expect(exitCode).toBe(0);
      expect(userDataSnapshot()).toEqual(EMPTY);
    });
  }

  it("plans a `*` pin whose plugin declares no version, as the install would", async () => {
    setupRoot("*", null);
    const { exitCode, output } = await apply(["--dry-run"]);
    expect(output).toContain("would install dup 0.0.0 (dup@mkta)");
    expect(exitCode).toBe(0);
    expect(userDataSnapshot()).toEqual(EMPTY);
  });

  it("still fails a range no marketplace version satisfies", async () => {
    setupRoot("^2.0.0");
    const { exitCode, output } = await apply(["--dry-run"]);
    expect(exitCode).not.toBe(0);
    expect(output).not.toContain("would install dup");
    expect(userDataSnapshot()).toEqual(EMPTY);
  });

  for (const constraint of ["*", "1.0.0"]) {
    it(`leaves the pin to install on the next real apply (${constraint})`, async () => {
      setupRoot(constraint);
      expect((await apply(["--dry-run"])).exitCode).toBe(0);
      const metadata = findPluginResourceByPin("dup@mkta", constraint)?.metadata as PluginPinMetadata | undefined;
      expect(metadata?.resolved_version).toBeUndefined();

      const real = await apply(["--yes"]);
      expect(real.exitCode).toBe(0);
      expect(real.output).toContain("synced 1 linked resource");
      expect(existsSync(join(project, ".agents/skills/dup-skill/SKILL.md"))).toBe(true);
      expect(existsSync(join(project, ".claude/plugins/cache/mkta/dup/1.0.0/skills/dup-skill/SKILL.md"))).toBe(true);
    });
  }
});

describe("Desktop apply preview with an inexact dependency that is not installed", () => {
  async function preview(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
    resetAgentApplyInProgressForTests();
    const response = await tryHandle(
      new Request("http://127.0.0.1/v1/apply", {
        method: "POST",
        headers: { authorization: "Bearer t", "content-type": "application/json" },
        body: JSON.stringify({ plugins: ["root"], dryRun: true, harness: "claude-code", ...body }),
      }),
      "t",
      { isAgentSwitchInProgress: () => false },
    );
    return { status: response?.status ?? 0, json: (await response?.json()) as Record<string, unknown> };
  }

  it("previews a project apply and lists the plugin it would install", async () => {
    setupRoot("*");
    const { status, json } = await preview({ scope: "project", projectPath: project });
    expect(status).toBe(200);
    expect(json.would_install_plugins).toEqual([{ ref: "dup@mkta", name: "dup", version: "1.0.0" }]);
    expect(userDataSnapshot()).toEqual(EMPTY);
  });

  it("previews a profile apply in home scope", async () => {
    setPluginTags(setupRoot("*"), ["profile"]);
    const { status, json } = await preview({ scope: "home" });
    expect(String(json.message ?? "")).not.toContain("No local version of");
    expect(status).toBe(200);
    expect(json.dry_run).toBe(true);
    expect(userDataSnapshot()).toEqual(EMPTY);
  });
});
