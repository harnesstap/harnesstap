import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("apply-shared-agents-idempotent-");
});

afterEach(async () => {
  await ctx.cleanup();
});

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

/** Codex puts rules in AGENTS.md and Gemini puts skills there: two different slices of one file. */
function writeProject(): void {
  writeTextFile(
    join(ctx.projectDir, "apm.yml"),
    `name: demo
version: "1.0.0"
targets: [claude, cursor, codex, copilot, gemini, opencode]
dependencies:
  mcp:
    - name: local-fs
      registry: false
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
`,
  );
  for (const n of [1, 2, 3]) {
    writeTextFile(
      join(ctx.projectDir, ".apm", "skills", `skill-${n}`, "SKILL.md"),
      `---\nname: skill-${n}\ndescription: Skill ${n}\n---\n# Skill ${n}\nDo thing ${n}.\n`,
    );
    writeTextFile(
      join(ctx.projectDir, ".apm", "instructions", `rule-${n}.instructions.md`),
      `---\ndescription: Rule ${n}\napplyTo: "**/*.ts"\n---\nRule ${n} body.\n`,
    );
  }
  writeTextFile(
    join(ctx.projectDir, ".apm", "agents", "agent-1.agent.md"),
    "---\nname: agent-1\ndescription: Agent 1\n---\nYou are agent 1.\n",
  );
}

interface ApplyJson {
  platforms: Array<{ platform: string; written_files: string[] }>;
}

async function applyJson(...extra: string[]): Promise<ApplyJson> {
  const result = await runCli([
    "apply",
    "--project",
    ctx.projectDir,
    "--no-interactive",
    "--format",
    "json",
    ...extra,
  ]);
  expect(result.exitCode ?? 0, result.stderr || result.stdout).toBe(0);
  return JSON.parse(result.stdout) as ApplyJson;
}

function writtenPaths(payload: ApplyJson): string[] {
  return payload.platforms.flatMap((platform) => platform.written_files);
}

describe("ht apply with harnesses that share AGENTS.md", () => {
  it("applies a fresh project without a conflict and keeps both slices in AGENTS.md", async () => {
    writeProject();

    const first = await applyJson();

    expect(writtenPaths(first)).toContain("AGENTS.md");
    const agents = readFileSync(join(ctx.projectDir, "AGENTS.md"), "utf-8");
    expect(agents).toContain("Rule 1 body.");
    expect(agents).toContain("Do thing 1.");
  });

  it("writes nothing on a repeated identical apply", async () => {
    writeProject();
    await applyJson();
    const before = projectTree(ctx.projectDir);

    const second = await applyJson();
    const third = await applyJson("--on-conflict", "replace");

    expect(writtenPaths(second)).toEqual([]);
    expect(writtenPaths(third)).toEqual([]);
    expect(projectTree(ctx.projectDir)).toEqual(before);
  });

  it("reports a repeated apply as up to date in the human summary", async () => {
    writeProject();
    await applyJson();

    const result = await runCli(["apply", "--project", ctx.projectDir, "--no-interactive"]);

    expect(result.exitCode ?? 0, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("Everything is up to date");
    expect(result.stdout).not.toMatch(/Wrote \d/);
  });
});
