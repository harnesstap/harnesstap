import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("apply-update-cancel-lock-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function gitIn(cwd: string, args: string): string {
  return execSync(`git -c user.email=test@example.com -c user.name=Test ${args}`, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function writeSkill(root: string, name: string, body: string): void {
  mkdirSync(join(root, "skills", name), { recursive: true });
  writeFileSync(
    join(root, "skills", name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name}\n---\n# ${body}\n`,
  );
}

function createRemote(): string {
  const dir = createTempDir("apm-apply-cancel-git-");
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(dir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "ship-kit", version: "1.0.0" }),
  );
  writeSkill(dir, "ship", "SHIP-V1");
  writeSkill(dir, "old", "OLD-V1");
  gitIn(dir, "init");
  gitIn(dir, "add -A");
  gitIn(dir, "commit -m init");
  return dir;
}

function apply(...extra: string[]) {
  return runCli([
    "apply",
    "--project",
    ctx.projectDir,
    "--harness",
    "claude-code",
    "--no-interactive",
    ...extra,
  ]);
}

describe("apply --update cancelled by a conflict", () => {
  it("keeps the previous lock so the next apply removes the stale file", async () => {
    const remote = createRemote();
    try {
      writeTextFile(
        join(ctx.projectDir, "apm.yml"),
        `name: demo
version: "1.0.0"
dependencies:
  apm:
    - git: file://${remote}
`,
      );
      const first = await apply("--on-conflict", "replace");
      expect(first.exitCode ?? 0, first.stderr || first.stdout).toBe(0);
      const oldSkill = join(ctx.projectDir, ".claude/skills/old/SKILL.md");
      const shipSkill = join(ctx.projectDir, ".claude/skills/ship/SKILL.md");
      expect(existsSync(oldSkill)).toBe(true);
      const lockPath = join(ctx.projectDir, "apm.lock.yaml");
      const lockBefore = readFileSync(lockPath, "utf8");
      expect(lockBefore).toContain(".claude/skills/old/SKILL.md");

      // Upstream drops the `old` skill, changes `ship`, and adds `fresh`.
      rmSync(join(remote, "skills", "old"), { recursive: true, force: true });
      writeSkill(remote, "ship", "SHIP-V2");
      writeSkill(remote, "fresh", "FRESH-V1");
      gitIn(remote, "add -A");
      gitIn(remote, "commit -m next");

      // A file of the user's own already sits where `fresh` goes, so the
      // update conflicts and cancel stops it.
      const freshSkill = join(ctx.projectDir, ".claude/skills/fresh/SKILL.md");
      writeTextFile(freshSkill, "# mine\n");
      // Loaded lazily: a top-level import of the lockfile module first trips a
      // module cycle through apm-pack.
      const lockfileService = await import("../../src/services/lockfile.ts");
      const writeSpy = spyOn(lockfileService, "writeLockfile");
      try {
        const cancelled = await apply("--update", "--on-conflict", "cancel");
        expect(cancelled.exitCode).toBe(1);
        expect(`${cancelled.stdout}${cancelled.stderr}`).toContain("cancelled");
        expect(writeSpy).not.toHaveBeenCalled();
      } finally {
        writeSpy.mockRestore();
      }
      expect(readFileSync(lockPath, "utf8")).toBe(lockBefore);
      expect(readFileSync(shipSkill, "utf8")).toContain("SHIP-V1");
      expect(readFileSync(freshSkill, "utf8")).toBe("# mine\n");
      expect(existsSync(oldSkill)).toBe(true);

      // The next apply still knows it deployed `old` and removes it.
      const retried = await apply("--update", "--on-conflict", "replace");
      expect(retried.exitCode ?? 0, retried.stderr || retried.stdout).toBe(0);
      expect(readFileSync(shipSkill, "utf8")).toContain("SHIP-V2");
      expect(existsSync(oldSkill)).toBe(false);
      const lockAfter = readFileSync(lockPath, "utf8");
      expect(lockAfter).not.toContain(".claude/skills/old/SKILL.md");
      expect(lockAfter).toContain(".claude/skills/ship/SKILL.md");
    } finally {
      cleanupDir(remote);
    }
  });
});
