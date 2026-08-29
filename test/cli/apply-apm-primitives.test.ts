import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("apply-apm-primitives-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function writeLocalPrimitives(projectDir: string): void {
  writeTextFile(
    join(projectDir, "apm.yml"),
    `name: demo
version: "1.0.0"
targets: [claude]
`,
  );
  writeTextFile(
    join(projectDir, ".apm", "skills", "ship", "SKILL.md"),
    `---
name: ship
description: Ship checklist
---
Run the checklist.
`,
  );
  writeTextFile(join(projectDir, ".apm", "skills", "ship", "scripts", "go.sh"), "echo go\n");
  writeTextFile(
    join(projectDir, ".apm", "agents", "reviewer.agent.md"),
    `---
name: reviewer
description: Reviews diffs
---
Be thorough.
`,
  );
  writeTextFile(join(projectDir, ".apm", "commands", "draft.md"), "Draft this change.\n");
  writeTextFile(
    join(projectDir, ".apm", "instructions", "always.instructions.md"),
    `---
description: Always
---
Be kind.
`,
  );
  writeTextFile(
    join(projectDir, ".apm", "instructions", "style.instructions.md"),
    `---
description: Style
applyTo: "src/**/*.ts"
---
Use spaces.
`,
  );
  writeTextFile(
    join(projectDir, ".apm", "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ command: "echo pre" }],
      },
    }),
  );
}

describe("ht apply compiles .apm primitives", () => {
  it("materializes local primitives into harness dirs and records hashes", async () => {
    writeLocalPrimitives(ctx.projectDir);

    const result = await runCli([
      "apply",
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);

    expect(result.exitCode ?? 0).toBe(0);
    expect(readFileSync(join(ctx.projectDir, "CLAUDE.md"), "utf8")).toContain("Be kind.");
    expect(readFileSync(join(ctx.projectDir, ".claude", "rules", "style.md"), "utf8")).toContain(
      "Use spaces.",
    );
    expect(
      readFileSync(join(ctx.projectDir, ".claude", "skills", "ship", "SKILL.md"), "utf8"),
    ).toContain("Run the checklist.");
    expect(
      existsSync(join(ctx.projectDir, ".claude", "skills", "ship", "scripts", "go.sh")),
    ).toBe(true);
    expect(
      readFileSync(join(ctx.projectDir, ".claude", "agents", "reviewer.md"), "utf8"),
    ).toContain("Be thorough.");
    expect(
      readFileSync(join(ctx.projectDir, ".claude", "commands", "draft.md"), "utf8"),
    ).toContain("Draft this change.");
    expect(
      readFileSync(join(ctx.projectDir, ".claude", "settings.json"), "utf8"),
    ).toContain("echo pre");

    const lock = readFileSync(join(ctx.projectDir, "apm.lock.yaml"), "utf8");
    expect(lock).toContain("local_deployed_file_hashes:");
    expect(lock).toContain("CLAUDE.md:");
    expect(lock).toContain(".claude/skills/ship/SKILL.md:");
  });

  it("honors compilation.target when top-level targets are omitted", async () => {
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
compilation:
  target: cursor
`,
    );
    writeTextFile(
      join(ctx.projectDir, ".apm", "agents", "reviewer.md"),
      `---
name: reviewer
---
Review cursor files.
`,
    );

    const result = await runCli([
      "apply",
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);

    expect(result.exitCode ?? 0).toBe(0);
    expect(
      readFileSync(join(ctx.projectDir, ".cursor", "agents", "reviewer.md"), "utf8"),
    ).toContain("Review cursor files.");
    expect(existsSync(join(ctx.projectDir, "CLAUDE.md"))).toBe(false);
  });

  it("warns when root primitive dirs are skipped because .apm/ is present", async () => {
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
targets: [claude]
`,
    );
    writeTextFile(join(ctx.projectDir, ".apm", "skills", "kept", "SKILL.md"), "# Kept\n");
    writeTextFile(join(ctx.projectDir, "skills", "skipped", "SKILL.md"), "# Skipped\n");

    const result = await runCli([
      "apply",
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);

    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stderr + result.stdout).toContain("Skipping root-level skills/");
    expect(existsSync(join(ctx.projectDir, ".claude", "skills", "kept", "SKILL.md"))).toBe(true);
    expect(existsSync(join(ctx.projectDir, ".claude", "skills", "skipped", "SKILL.md"))).toBe(
      false,
    );
  });
});
