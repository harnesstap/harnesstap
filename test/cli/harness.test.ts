import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";

describe("CLI harness", () => {
  it("sets and shows global harness preferences non-interactively", async () => {
    const context = await createTestContext("cli-harness-global");
    try {
      await runCli(["init"]);
      await runCli([
        "harness",
        "set",
        "--main",
        "claude-code",
        "--aliases",
        "cursor,codex",
      ]);

      const show = await runCli(["harness", "status", "--format", "json"]);
      expect(JSON.parse(show.stdout)).toEqual(
        expect.objectContaining({
          main_harness: "claude-code",
          alias_harnesses: ["cursor", "codex"],
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("sets and shows project harness preferences non-interactively", async () => {
    const context = await createTestContext("cli-harness-project");
    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-harness.git");
      await runCli(["init"]);

      await runCli([
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
    } finally {
      await context.cleanup();
    }
  });
});
