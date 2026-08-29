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
  it("compiles cursor and claude from --target via apply-from-manifest", async () => {
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
    expect(
      readFileSync(join(ctx.projectDir, ".cursor", "rules", "always.mdc"), "utf8"),
    ).toContain("Be kind.");
    expect(readFileSync(join(ctx.projectDir, "CLAUDE.md"), "utf8")).toContain("Be kind.");
    expect(existsSync(join(ctx.projectDir, "apm.lock.yaml"))).toBe(true);
    expect(readFileSync(join(ctx.projectDir, "apm.lock.yaml"), "utf8")).toContain(
      "local_deployed_file_hashes",
    );
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
    expect(
      readFileSync(join(ctx.projectDir, ".cursor", "rules", "always.mdc"), "utf8"),
    ).toContain("Be kind.");
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

  it("lets declared targets win over ht init harness preference", async () => {
    const init = await runCli(["init", "--main", "claude-code"]);
    expect(init.exitCode ?? 0, init.stderr || init.stdout).toBe(0);

    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
targets: [cursor]
`,
    );
    writeInstruction(ctx.projectDir);

    const compiled = await runCli([
      "compile",
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);
    expect(compiled.exitCode ?? 0, compiled.stderr || compiled.stdout).toBe(0);
    expect(
      readFileSync(join(ctx.projectDir, ".cursor", "rules", "always.mdc"), "utf8"),
    ).toContain("Be kind.");
    expect(existsSync(join(ctx.projectDir, "CLAUDE.md"))).toBe(false);

    const preview = await runCli(["targets", "--project", ctx.projectDir, "--json"]);
    expect(preview.exitCode ?? 0).toBe(0);
    const payload = JSON.parse(preview.stdout) as { source: string; resolved: string[] };
    expect(payload.source).toBe("manifest");
    expect(payload.resolved).toEqual(["cursor"]);
  });

  it("uses harness preference when targets: is omitted", async () => {
    const init = await runCli(["init", "--main", "claude-code"]);
    expect(init.exitCode ?? 0, init.stderr || init.stdout).toBe(0);

    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
`,
    );
    writeInstruction(ctx.projectDir);

    const compiled = await runCli([
      "compile",
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);
    expect(compiled.exitCode ?? 0, compiled.stderr || compiled.stdout).toBe(0);
    expect(readFileSync(join(ctx.projectDir, "CLAUDE.md"), "utf8")).toContain("Be kind.");
    expect(existsSync(join(ctx.projectDir, ".cursor", "rules", "always.mdc"))).toBe(false);

    const preview = await runCli(["targets", "--project", ctx.projectDir, "--json"]);
    expect(preview.exitCode ?? 0).toBe(0);
    const payload = JSON.parse(preview.stdout) as {
      source: string;
      harnesses: string[];
    };
    expect(payload.source).toBe("preference");
    expect(payload.harnesses).toEqual(["claude-code"]);
  });

  it("fails closed when compile cannot resolve a target", async () => {
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
    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toContain("No harness targets configured");
    expect(existsSync(join(ctx.projectDir, ".cursor", "rules", "always.mdc"))).toBe(false);
    expect(existsSync(join(ctx.projectDir, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(ctx.projectDir, "CLAUDE.md"))).toBe(false);
  });

  it("rejects a plugin selector", async () => {
    const result = await runCli([
      "compile",
      "team-stack",
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toContain("does not take a plugin selector");
  });

  it("exposes project-scope apply flags and not --global", async () => {
    const result = await runCli(["compile", "--help"]);
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toContain("--project");
    expect(result.stdout).toContain("--dry-run");
    expect(result.stdout).toContain("--harness");
    expect(result.stdout).toContain("--target");
    expect(result.stdout).toContain("--all");
    expect(result.stdout).not.toMatch(/^\s+--global\b/m);
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
    expect(result.stderr + result.stdout).toContain("No harness targets configured");
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
    expect(
      readFileSync(join(ctx.projectDir, ".cursor", "rules", "always.mdc"), "utf8"),
    ).toContain("Be kind.");
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
    expect(existsSync(join(ctx.projectDir, ".cursor", "rules", "always.mdc"))).toBe(false);
  });
});
