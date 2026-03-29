import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI apply", () => {
  it("supports dry-run output and writes files plus snapshot state", async () => {
    const context = await createTestContext("cli-apply");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/skillset-apply.git");
      await runCli(["init"]);

      const presetModel = await import("../../src/models/preset.ts");
      const projectModel = await import("../../src/models/project.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const snapshotModel = await import("../../src/models/snapshot.ts");
      const preset = presetModel.createPreset({ name: "applied" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "project-context",
          content: "# Applied instructions",
        }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const dryRun = await runCli([
        "apply",
        "applied",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
        "--dry-run",
      ]);

      expect(dryRun.stdout).toContain("CLAUDE.md");

      const applyResult = await runCli([
        "apply",
        "applied",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
      ]);

      const project = projectModel.getProjectByOrigin(
        "git@github.com:acme/skillset-apply.git",
      );

      expect(applyResult.stdout).toContain("claude-code: wrote 1 file(s)");
      expect(existsSync(`${context.projectDir}/CLAUDE.md`)).toBe(true);
      expect(project).toBeDefined();
      expect(snapshotModel.listSnapshots(project!.id)).toHaveLength(2);
    } finally {
      await context.cleanup();
    }
  });
});
