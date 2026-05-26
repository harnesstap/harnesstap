import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";

describe("CLI harness", () => {
  it("lists harnesses and supports noun-group aliases", async () => {
    const context = await createTestContext("cli-harness-list-aliases");
    try {
      await runCli(["init"]);

      const harnessList = await runCli(["harness", "list", "--format", "json"]);
      expect(JSON.parse(harnessList.stdout)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "claude-code" })]),
      );

      const supportedHarnessList = await runCli([
        "h",
        "list",
        "--supported",
        "--format",
        "json",
      ], { commandName: "hd" });
      const supportedHarnesses = JSON.parse(supportedHarnessList.stdout) as {
        id: string;
      }[];
      expect(supportedHarnesses.map((platform) => platform.id)).toEqual([
        "claude-code",
        "codex",
        "cursor",
        "opencode",
        "github-copilot",
        "copilot-cli",
      ]);

      const presetList = await runCli(["p", "ls", "--format", "json"], {
        commandName: "hd",
      });
      expect(Array.isArray(JSON.parse(presetList.stdout))).toBe(true);

      const resourceList = await runCli(["r", "ls", "--format", "json"], {
        commandName: "hd",
      });
      expect(Array.isArray(JSON.parse(resourceList.stdout))).toBe(true);

      const projectStatus = await runCli([
        "pj",
        "status",
        context.projectDir,
        "--format",
        "json",
      ], { commandName: "hd" });
      expect(JSON.parse(projectStatus.stdout)).toEqual(
        expect.objectContaining({ project_root: expect.any(String) }),
      );

      const cloudWhoami = await runCli(["c", "whoami", "--format", "json"], {
        commandName: "hd",
      });
      expect(JSON.parse(cloudWhoami.stdout)).toEqual({});

      const supportedAlias = await runCli([
        "platforms",
        "--supported",
        "--format",
        "json",
      ], { commandName: "hd" });
      expect(JSON.parse(supportedAlias.stdout)).toEqual(
        supportedHarnesses,
      );
      expect(supportedAlias.stderr).toContain("deprecated");
      expect(supportedAlias.stderr).toContain("hd harness list");
    } finally {
      await context.cleanup();
    }
  });

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

  it("auto-prompts harness set on a TTY when required args are missing", async () => {
    const context = await createTestContext("cli-harness-global-wizard");
    try {
      const result = await runCli(["harness", "set"], {
        isTTY: true,
        promptResponses: [
          { main_harness: "claude-code" },
          { alias_harnesses: ["cursor"] },
        ],
      });

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("Set harness preference");
    } finally {
      await context.cleanup();
    }
  });

  it("fails when a test provides prompt responses that are never consumed", async () => {
    const context = await createTestContext("cli-unused-prompt-responses");
    try {
      await expect(
        runCli(["harness", "list", "--format", "json"], {
          promptResponses: [{ value: "unused" }],
        }),
      ).rejects.toThrow(/unused prompt responses/i);
    } finally {
      await context.cleanup();
    }
  });

  it("init uses the shared trigger rule for auto-prompting", async () => {
    const context = await createTestContext("cli-init-shared-trigger");
    try {
      const prompted = await runCli(["init"], {
        isTTY: true,
        promptResponses: [
          { main_harness: "claude-code" },
          { alias_harnesses: ["cursor"] },
        ],
      });

      expect(prompted.exitCode ?? 0).toBe(0);
      expect(prompted.stdout).toContain("MAIN HARNESS");

      const jsonSuppressed = await runCli(["init", "--format", "json"], {
        isTTY: true,
      });
      expect(jsonSuppressed.exitCode ?? 0).toBe(0);
      expect(jsonSuppressed.stdout).not.toContain("harness_preference");

      const ciSuppressed = await runCli(["init"], {
        isTTY: true,
        env: { CI: "true" },
      });
      expect(ciSuppressed.exitCode ?? 0).toBe(0);
      expect(ciSuppressed.stdout).not.toContain("MAIN HARNESS");

      const disabled = await runCli(["--no-interactive", "init"], {
        isTTY: true,
      });
      expect(disabled.exitCode ?? 0).toBe(0);
      expect(disabled.stdout).not.toContain("MAIN HARNESS");
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

  it("auto-prompts project harness set on a TTY when required args are missing", async () => {
    const context = await createTestContext("cli-harness-project-wizard");
    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-harness-wizard.git");
      await runCli(["init"]);

      const result = await runCli([
        "harness",
        "project",
        "set",
        "--project",
        context.projectDir,
      ], {
        isTTY: true,
        promptResponses: [
          { main_harness: "cursor" },
          { alias_harnesses: ["codex"] },
        ],
      });

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("Set project harness preference");
    } finally {
      await context.cleanup();
    }
  });
});
