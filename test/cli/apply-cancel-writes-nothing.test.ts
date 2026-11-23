import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("apply-cancel-writes-nothing-");
});

afterEach(async () => {
  await ctx.cleanup();
});

/** Every file under the project (path to content hash), apm sources included. */
function projectTree(root: string): Record<string, string> {
  const tree: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (statSync(full).isFile()) {
        tree[relative(root, full)] = createHash("sha256").update(readFileSync(full)).digest("hex");
      }
    }
  };
  walk(root);
  return tree;
}

function writeProject(targets: string): void {
  writeTextFile(
    join(ctx.projectDir, "apm.yml"),
    `name: demo
version: "1.0.0"
targets: [${targets}]
`,
  );
  writeTextFile(
    join(ctx.projectDir, ".apm", "skills", "ship", "SKILL.md"),
    "---\nname: ship\ndescription: Ship checklist\n---\nRun the checklist.\n",
  );
  writeTextFile(
    join(ctx.projectDir, ".apm", "agents", "reviewer.agent.md"),
    "---\nname: reviewer\ndescription: Reviews diffs\n---\nBe thorough.\n",
  );
  writeTextFile(
    join(ctx.projectDir, ".apm", "instructions", "style.instructions.md"),
    "---\ndescription: Style\napplyTo: \"src/**/*.ts\"\n---\nUse spaces.\n",
  );
}

function apply(...extra: string[]) {
  return runCli(["apply", "--project", ctx.projectDir, "--no-interactive", ...extra]);
}

describe("ht apply cancelled by a conflict", () => {
  it("writes nothing when a later harness hits the user's own AGENTS.md", async () => {
    writeProject("claude, cursor, codex");
    const userAgents = "# My own rules\n\nKeep this exactly.\n";
    writeTextFile(join(ctx.projectDir, "AGENTS.md"), userAgents);
    const before = projectTree(ctx.projectDir);

    const result = await apply();

    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("AGENTS.md would change");
    expect(projectTree(ctx.projectDir)).toEqual(before);
    expect(readFileSync(join(ctx.projectDir, "AGENTS.md"), "utf-8")).toBe(userAgents);
    expect(existsSync(join(ctx.projectDir, ".claude"))).toBe(false);
    expect(existsSync(join(ctx.projectDir, ".cursor"))).toBe(false);
    expect(existsSync(join(ctx.projectDir, "apm.lock.yaml"))).toBe(false);
  });

  it("keeps the previous lock and every deployed file when a re-apply is cancelled", async () => {
    writeProject("claude, codex");
    const first = await apply();
    expect(first.exitCode ?? 0, first.stderr || first.stdout).toBe(0);

    // The project gains a skill and a harness whose agent file is the user's own.
    writeTextFile(
      join(ctx.projectDir, ".apm", "skills", "extra", "SKILL.md"),
      "---\nname: extra\ndescription: Extra\n---\nDo extra.\n",
    );
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
targets: [claude, codex, cursor]
`,
    );
    mkdirSync(join(ctx.projectDir, ".cursor", "agents"), { recursive: true });
    writeTextFile(join(ctx.projectDir, ".cursor", "agents", "reviewer.md"), "mine\n");
    const before = projectTree(ctx.projectDir);

    const second = await apply("--update");

    expect(second.exitCode).toBe(1);
    expect(projectTree(ctx.projectDir)).toEqual(before);
  });

  it("applies the rest and keeps the user's file once the conflict is replaced explicitly", async () => {
    writeProject("claude, cursor, codex");
    const userAgents = "# My own rules\n";
    writeTextFile(join(ctx.projectDir, "AGENTS.md"), userAgents);

    const result = await apply("--on-conflict", "replace");

    expect(result.exitCode ?? 0, result.stderr || result.stdout).toBe(0);
    expect(existsSync(join(ctx.projectDir, ".claude/skills/ship/SKILL.md"))).toBe(true);
    expect(readFileSync(join(ctx.projectDir, "AGENTS.md"), "utf-8")).toBe(userAgents);
    expect(existsSync(join(ctx.projectDir, "apm.lock.yaml"))).toBe(true);
  });
});
