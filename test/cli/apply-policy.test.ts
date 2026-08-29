import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("apply-policy-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("ht apply policy gate", () => {
  it("aborts before writing when policy blocks a primitive", async () => {
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
targets: [claude]
`,
    );
    writeTextFile(
      join(ctx.projectDir, "apm-policy.yml"),
      `name: baseline
enforcement: block
manifest:
  content_types:
    allow:
      - skill
`,
    );
    writeTextFile(
      join(ctx.projectDir, ".apm", "instructions", "always.instructions.md"),
      `---
description: Always
---
Be kind.
`,
    );

    const result = await runCli([
      "apply",
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/instruction|policy/i);
    expect(existsSync(join(ctx.projectDir, "CLAUDE.md"))).toBe(false);
  });

  it("does not write when policy.hash is pinned and apm-policy.yml is missing", async () => {
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
targets: [claude]
policy:
  hash: sha256:0000000000000000000000000000000000000000000000000000000000000000
`,
    );
    writeTextFile(
      join(ctx.projectDir, ".apm", "instructions", "always.instructions.md"),
      "---\ndescription: Always\n---\nBe kind.\n",
    );

    const result = await runCli([
      "apply",
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/policy\.hash|missing/i);
    expect(existsSync(join(ctx.projectDir, "CLAUDE.md"))).toBe(false);
  });
});
