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

      expect(result.stdout).toContain("Imported");
      expect(result.stdout).toContain("Project registered");
      expect(resourceModel.listResources().length).toBeGreaterThan(0);
      expect(
        projectModel.getProjectByOrigin("git@github.com:acme/skilldeck-fixture.git"),
      ).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });
});
