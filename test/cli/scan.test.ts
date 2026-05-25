import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { writeTextFile } from "../helpers/fs.ts";

describe("CLI scan", () => {
  it("imports detected project resources and registers the project", async () => {
    const context = await createTestContext("cli-scan");

    try {
      initGitRepo(context.projectDir);
      writeTextFile(`${context.projectDir}/CLAUDE.md`, "# Claude instructions");
      writeTextFile(
        `${context.projectDir}/.claude/skills/research/SKILL.md`,
        "---\nname: research\ndescription: Research helper\n---\n# Research\n",
      );

      await runCli(["init"]);
      const result = await runCli(["project", "scan", context.projectDir]);

      const resourceModel = await import("../../src/models/resource.ts");
      const projectModel = await import("../../src/models/project.ts");

      // Per-platform verdict output
      expect(result.stdout).toContain("claude-code");
      // Proper singular/plural: "1 resource" not "1 resources"
      expect(result.stdout).toMatch(/\d+ resources?/);
      expect(result.stdout).not.toContain("1 resources");
      // Project registration verdict
      expect(result.stdout).toContain("Project registered");
      expect(resourceModel.listResources().length).toBeGreaterThan(0);
      expect(
        projectModel.getProjectByOrigin("git@github.com:acme/harnessdeck-fixture.git"),
      ).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });

  it("shows dry-run prefix in human mode without persisting", async () => {
    const context = await createTestContext("cli-scan-dry");

    try {
      initGitRepo(context.projectDir);
      writeTextFile(`${context.projectDir}/CLAUDE.md`, "# Dry run test");

      await runCli(["init"]);
      const result = await runCli(["project", "scan", context.projectDir, "--dry-run"]);

      // Dry-run uses [dry run] prefix
      expect(result.stdout).toContain("[dry run]");
      expect(result.stdout).toContain("claude-code");
      // No project registration in dry-run
      expect(result.stdout).not.toContain("Project registered");
    } finally {
      await context.cleanup();
    }
  });
});
