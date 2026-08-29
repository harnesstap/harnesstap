import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("compile-matrix-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function writeInstruction(projectDir: string, body = "Be kind."): void {
  writeTextFile(
    join(projectDir, ".apm", "instructions", "always.instructions.md"),
    `---
description: Always
---
${body}
`,
  );
}

describe("ht compile / ht targets", () => {
  it("compiles cursor and claude from --target", async () => {
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
`,
    );
    writeInstruction(ctx.projectDir);

    const result = await runCli([
      "compile",
      "--project",
      ctx.projectDir,
      "--target",
      "cursor,claude",
      "--no-interactive",
    ]);

    expect(result.exitCode ?? 0, result.stderr || result.stdout).toBe(0);
    expect(readFileSync(join(ctx.projectDir, "AGENTS.md"), "utf8")).toContain("Be kind.");
    expect(readFileSync(join(ctx.projectDir, "CLAUDE.md"), "utf8")).toContain("Be kind.");
  });

  it("lets declared targets win over machine-local folders", async () => {
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
targets: [cursor]
`,
    );
    writeInstruction(ctx.projectDir);
    mkdirSync(join(ctx.projectDir, ".claude"), { recursive: true });

    const compiled = await runCli([
      "compile",
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);
    expect(compiled.exitCode ?? 0, compiled.stderr || compiled.stdout).toBe(0);
    expect(readFileSync(join(ctx.projectDir, "AGENTS.md"), "utf8")).toContain("Be kind.");
    expect(existsSync(join(ctx.projectDir, "CLAUDE.md"))).toBe(false);

    const preview = await runCli([
      "targets",
      "--project",
      ctx.projectDir,
      "--json",
    ]);
    expect(preview.exitCode ?? 0).toBe(0);
    const payload = JSON.parse(preview.stdout) as {
      source: string;
      resolved: string[];
    };
    expect(payload.source).toBe("manifest");
    expect(payload.resolved).toEqual(["cursor"]);
  });

  it("writes nothing when compile cannot resolve a target", async () => {
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
`,
    );
    writeInstruction(ctx.projectDir);

    const result = await runCli([
      "compile",
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stderr + result.stdout).toContain("wrote nothing");
    expect(existsSync(join(ctx.projectDir, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(ctx.projectDir, "CLAUDE.md"))).toBe(false);
  });
});

describe("ht install target resolution", () => {
  it("fails closed when no target can be resolved", async () => {
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
`,
    );
    writeInstruction(ctx.projectDir);

    const result = await runCli([
      "install",
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toContain("No compile target could be resolved");
    expect(existsSync(join(ctx.projectDir, "CLAUDE.md"))).toBe(false);
  });

  it("installs only declared targets when another harness folder exists", async () => {
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
targets: [cursor]
`,
    );
    writeInstruction(ctx.projectDir);
    mkdirSync(join(ctx.projectDir, ".claude"), { recursive: true });

    const result = await runCli([
      "install",
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);
    expect(result.exitCode ?? 0, result.stderr || result.stdout).toBe(0);
    expect(readFileSync(join(ctx.projectDir, "AGENTS.md"), "utf8")).toContain("Be kind.");
    expect(existsSync(join(ctx.projectDir, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(ctx.projectDir, "apm.lock.yaml"))).toBe(true);
  });

  it("lets --target override declared targets on install", async () => {
    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
targets: [cursor]
`,
    );
    writeInstruction(ctx.projectDir);

    const result = await runCli([
      "install",
      "--project",
      ctx.projectDir,
      "--target",
      "claude",
      "--no-interactive",
    ]);
    expect(result.exitCode ?? 0, result.stderr || result.stdout).toBe(0);
    expect(readFileSync(join(ctx.projectDir, "CLAUDE.md"), "utf8")).toContain("Be kind.");
    expect(existsSync(join(ctx.projectDir, "AGENTS.md"))).toBe(false);
  });
});
