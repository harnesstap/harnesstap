import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import {
  addPluginAttachment,
  attachPluginPinToPlugin,
} from "../../src/services/plugin-composition.ts";

const fixtureHome = join(import.meta.dirname, "../fixtures/claude-plugins-home");

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("apply-resolve-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function attachInstruction(pluginId: string, content: string, ns: string): void {
  const resource = createResource({
    type: "instruction",
    name: "context",
    description: "",
    content,
    metadata: {},
    source: "test",
    namespace: ns,
  });
  addResourceToPlugin(pluginId, resource.id);
}

describe("plugin apply resolution", () => {
  it("gives the root's own resource precedence over its dependency", async () => {
    const base = createPlugin({ name: "base" });
    attachInstruction(base.id, "FROM-BASE", "base");
    const root = createPlugin({ name: "root" });
    attachInstruction(root.id, "FROM-ROOT", "root");
    const rootPlugin = getPluginByName("root");
    if (!rootPlugin) throw new Error("missing root");
    await addPluginAttachment({ plugin: rootPlugin, selector: "plugin:base" });

    await runCli([
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
    ]);

    expect(readFileSync(join(ctx.projectDir, "CLAUDE.md"), "utf8")).toContain(
      "FROM-ROOT",
    );
  });

  it("keeps last-wins for two plugins on argv", async () => {
    const a = createPlugin({ name: "a" });
    attachInstruction(a.id, "FROM-A", "a");
    const b = createPlugin({ name: "b" });
    attachInstruction(b.id, "FROM-B", "b");

    await runCli([
      "apply",
      "a",
      "b",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
    ]);

    expect(readFileSync(join(ctx.projectDir, "CLAUDE.md"), "utf8")).toContain(
      "FROM-B",
    );
  });

  it("writes a lockfile on apply", async () => {
    createPlugin({ name: "base" });
    const root = createPlugin({ name: "root" });
    attachInstruction(root.id, "ROOT", "root");
    const rootPlugin = getPluginByName("root");
    if (!rootPlugin) throw new Error("missing root");
    await addPluginAttachment({ plugin: rootPlugin, selector: "plugin:base" });

    await runCli([
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
    ]);

    const lockPath = join(ctx.projectDir, "apm.lock.yaml");
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, "utf8")).toContain("name: base");
  });

  it("does not write a lockfile on --dry-run", async () => {
    createPlugin({ name: "root" });
    await runCli([
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
      "--dry-run",
    ]);
    expect(existsSync(join(ctx.projectDir, "apm.lock.yaml"))).toBe(false);
  });

  it("does not write a lockfile for multi-selector (ephemeral) apply", async () => {
    const a = createPlugin({ name: "a" });
    attachInstruction(a.id, "FROM-A", "a");
    const b = createPlugin({ name: "b" });
    attachInstruction(b.id, "FROM-B", "b");

    await runCli([
      "apply",
      "a",
      "b",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
    ]);

    expect(existsSync(join(ctx.projectDir, "apm.lock.yaml"))).toBe(false);
  });

  it("prints the resolution trail with --explain", async () => {
    const base = createPlugin({ name: "base" });
    attachInstruction(base.id, "FROM-BASE", "base");
    const root = createPlugin({ name: "root" });
    attachInstruction(root.id, "FROM-ROOT", "root");
    const rootPlugin = getPluginByName("root");
    if (!rootPlugin) throw new Error("missing root");
    await addPluginAttachment({ plugin: rootPlugin, selector: "plugin:base" });

    const result = await runCli([
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
      "--explain",
      "--dry-run",
    ]);

    expect(result.stdout).toContain("base@");
    expect(result.stdout).toContain("instruction:context");
    expect(result.stdout).toContain("nearest to root");
  });

  it("errors on a singleton conflict at equal depth and names the fix", async () => {
    const a = createPlugin({ name: "a" });
    attachInstruction(a.id, "FROM-A", "a");
    const b = createPlugin({ name: "b" });
    attachInstruction(b.id, "FROM-B", "b");
    createPlugin({ name: "root" });
    const rootPlugin = getPluginByName("root");
    if (!rootPlugin) throw new Error("missing root");
    await addPluginAttachment({ plugin: rootPlugin, selector: "plugin:a" });
    await addPluginAttachment({ plugin: rootPlugin, selector: "plugin:b" });

    const result = await runCli([
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
      "--no-interactive",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("instruction:context");
    expect(result.stderr).toContain("--override");
  });

  it("prepares marketplace pins before composition so first apply includes plugin skills", async () => {
    cpSync(join(fixtureHome, ".claude"), join(ctx.homeDir, ".claude"), {
      recursive: true,
    });

    const root = createPlugin({ name: "root" });
    attachPluginPinToPlugin(root.id, "formatter@acme-marketplace", "1.2.3");
    // Deliberately do not call materializeUpstreamPluginPlugin — apply must
    // prepare the pin before the first composition resolve.
    expect(getPluginByName("formatter", "1.2.3")).toBeUndefined();

    const result = await runCli([
      "apply",
      "root",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code,cursor",
    ]);

    expect(result.exitCode ?? 0).toBe(0);
    expect(getPluginByName("formatter", "1.2.3")).toBeDefined();
    expect(
      existsSync(join(ctx.projectDir, ".cursor", "rules", "format-code.mdc")),
    ).toBe(true);
  });

  it("applies from apm.yml when no plugin selector is given", async () => {
    const local = createPlugin({ name: "team-stack" });
    attachInstruction(local.id, "FROM-MANIFEST", "team-stack");
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
dependencies:
  apm:
    - team-stack
  mcp:
    - name: demo-mcp
      command: echo
      registry: false
`,
    );

    const result = await runCli([
      "apply",
      "--project",
      ctx.projectDir,
      "--harness",
      "claude-code",
      "--no-interactive",
    ]);

    expect(result.exitCode ?? 0).toBe(0);
    expect(readFileSync(join(ctx.projectDir, "CLAUDE.md"), "utf8")).toContain(
      "FROM-MANIFEST",
    );
    expect(existsSync(join(ctx.projectDir, "apm.lock.yaml"))).toBe(true);
    expect(readFileSync(join(ctx.projectDir, "apm.lock.yaml"), "utf8")).toContain(
      "resource_map_hash:",
    );
  });

  it("pulls a git dependencies.apm entry on apply and replays the lock", async () => {
    const remote = createApplyGitRemote("FROM-GIT");
    try {
      writeTextFile(
        join(ctx.projectDir, "apm.yml"),
        `name: demo
version: "1.0.0"
dependencies:
  apm:
    - git: ${remote.url}
`,
      );

      const first = await runCli([
        "apply",
        "--project",
        ctx.projectDir,
        "--harness",
        "claude-code",
        "--no-interactive",
      ]);
      expect(first.exitCode ?? 0, first.stderr || first.stdout).toBe(0);
      expect(
        readFileSync(join(ctx.projectDir, ".claude/skills/ship/SKILL.md"), "utf8"),
      ).toContain("FROM-GIT");

      const lock = readFileSync(join(ctx.projectDir, "apm.lock.yaml"), "utf8");
      expect(lock).toContain("repo_url:");
      expect(lock).toContain("resolved_commit:");
      expect(lock).toContain(remote.sha);
      expect(lock).toContain("local_deployed_file_hashes:");
      expect(lock).toContain(".claude/skills/ship/SKILL.md");

      writeApplyGitSkill(remote.dir, "FROM-GIT-NEXT");
      gitIn(remote.dir, "add -A");
      gitIn(remote.dir, "commit -m next");

      const replay = await runCli([
        "apply",
        "--project",
        ctx.projectDir,
        "--harness",
        "claude-code",
        "--no-interactive",
      ]);
      expect(replay.exitCode ?? 0, replay.stderr || replay.stdout).toBe(0);
      expect(
        readFileSync(join(ctx.projectDir, ".claude/skills/ship/SKILL.md"), "utf8"),
      ).toContain("FROM-GIT");
      expect(
        readFileSync(join(ctx.projectDir, "apm.lock.yaml"), "utf8"),
      ).toContain(remote.sha);

      const updated = await runCli([
        "apply",
        "--project",
        ctx.projectDir,
        "--harness",
        "claude-code",
        "--no-interactive",
        "--update",
      ]);
      expect(updated.exitCode ?? 0, updated.stderr || updated.stdout).toBe(0);
      expect(
        readFileSync(join(ctx.projectDir, ".claude/skills/ship/SKILL.md"), "utf8"),
      ).toContain("FROM-GIT-NEXT");
      expect(
        readFileSync(join(ctx.projectDir, "apm.lock.yaml"), "utf8"),
      ).not.toContain(remote.sha);
    } finally {
      cleanupDir(remote.dir);
    }
  });

  it("records declared_license from the git dependency manifest", async () => {
    const remote = createApplyGitRemote("FROM-GIT");
    try {
      writeFileSync(
        join(remote.dir, "apm.yml"),
        `name: ship-kit
version: "1.0.0"
license: Apache-2.0
`,
      );
      gitIn(remote.dir, "add -A");
      gitIn(remote.dir, "commit -m license");
      writeTextFile(
        join(ctx.projectDir, "apm.yml"),
        `name: demo
version: "1.0.0"
dependencies:
  apm:
    - git: ${remote.url}
`,
      );

      const result = await runCli([
        "apply",
        "--project",
        ctx.projectDir,
        "--harness",
        "claude-code",
        "--no-interactive",
      ]);
      expect(result.exitCode ?? 0, result.stderr || result.stdout).toBe(0);
      const lock = readFileSync(join(ctx.projectDir, "apm.lock.yaml"), "utf8");
      expect(lock).toContain("declared_license: Apache-2.0");
    } finally {
      cleanupDir(remote.dir);
    }
  });

  it("fails closed when a git dependencies.apm ref cannot be resolved", async () => {
    const remote = createApplyGitRemote();
    try {
      writeTextFile(
        join(ctx.projectDir, "apm.yml"),
        `name: demo
version: "1.0.0"
dependencies:
  apm:
    - git: ${remote.url}
      ref: does-not-exist
`,
      );

      const result = await runCli([
        "apply",
        "--project",
        ctx.projectDir,
        "--harness",
        "claude-code",
        "--no-interactive",
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("does-not-exist");
      expect(existsSync(join(ctx.projectDir, "apm.lock.yaml"))).toBe(false);
    } finally {
      cleanupDir(remote.dir);
    }
  });
});

function gitIn(cwd: string, args: string): string {
  return execSync(`git -c user.email=test@example.com -c user.name=Test ${args}`, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function writeApplyGitSkill(root: string, skill: string): void {
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, "skills", "ship"), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "ship-kit", version: "1.0.0" }),
  );
  writeFileSync(
    join(root, "skills", "ship", "SKILL.md"),
    `---\nname: ship\ndescription: Ship\n---\n# ${skill}\n`,
  );
}

function createApplyGitRemote(skill = "FROM-GIT"): { dir: string; url: string; sha: string } {
  const dir = createTempDir("apm-apply-git-");
  writeApplyGitSkill(dir, skill);
  gitIn(dir, "init");
  gitIn(dir, "add -A");
  gitIn(dir, "commit -m init");
  const sha = gitIn(dir, "rev-parse HEAD");
  return { dir, url: `file://${dir}`, sha };
}
