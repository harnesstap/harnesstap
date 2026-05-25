import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";

describe("CLI harness", () => {
  it("renders project status as a detail panel with plugin state", async () => {
    const context = await createTestContext("cli-project-status-panel");
    try {
      await runCli(["init"]);
      const result = await runCli(["project", "status", context.projectDir]);
      expect(result.stdout).toContain("PROJECT");
      expect(result.stdout).toContain("Platforms");
      expect(result.stdout).toContain("Plugins");
    } finally {
      await context.cleanup();
    }
  });

  it("sets and shows global harness preferences non-interactively", async () => {
    const context = await createTestContext("cli-harness-global");
    try {
      await runCli(["init"]);
      const setResult = await runCli([
        "harness",
        "set",
        "--main",
        "claude-code",
        "--aliases",
        "cursor,codex",
      ]);
      expect(setResult.stdout).toContain("✓ Set harness preference");
      expect(setResult.stdout).toContain("main:");
      expect(setResult.stdout).toContain("claude-code");

      const show = await runCli(["harness", "status", "--format", "json"]);
      expect(JSON.parse(show.stdout)).toEqual(
        expect.objectContaining({
          main_harness: "claude-code",
          alias_harnesses: ["cursor", "codex"],
        }),
      );

      const human = await runCli(["harness", "status"]);
      expect(human.stdout).toContain("HARNESS");
      expect(human.stdout).toContain("Main harness");
      expect(human.stdout).toContain("Alias harnesses");
    } finally {
      await context.cleanup();
    }
  });

  it("sets and shows project harness preferences non-interactively", async () => {
    const context = await createTestContext("cli-harness-project");
    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-harness.git");
      await runCli(["init"]);

      const setResult = await runCli([
        "harness",
        "project",
        "set",
        "--project",
        context.projectDir,
        "--main",
        "cursor",
        "--aliases",
        "codex",
        "--materialization-strategy",
        "copy",
      ]);
      expect(setResult.stdout).toContain("✓ Set project harness preference");
      expect(setResult.stdout).toContain("main:");
      expect(setResult.stdout).toContain("cursor");

      const show = await runCli([
        "harness",
        "project",
        "status",
        "--project",
        context.projectDir,
        "--format",
        "json",
      ]);

      expect(JSON.parse(show.stdout)).toEqual(
        expect.objectContaining({
          main_harness: "cursor",
          alias_harnesses: ["codex"],
          materialization_strategy: "copy",
        }),
      );

      const human = await runCli([
        "harness",
        "project",
        "status",
        "--project",
        context.projectDir,
      ]);
      expect(human.stdout).toContain("HARNESS");
      expect(human.stdout).toContain("Main harness");
      expect(human.stdout).toContain("Materialization");
    } finally {
      await context.cleanup();
    }
  });
});
