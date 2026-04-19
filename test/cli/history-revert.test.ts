import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

function initGitRepo(projectDir: string): void {
  execSync("git init", { cwd: projectDir, stdio: "pipe" });
  execSync("git remote add origin git@github.com:acme/skilldeck-history.git", {
    cwd: projectDir,
    stdio: "pipe",
  });
}

describe("CLI history and revert", () => {
  it("lists snapshots and restores files from a snapshot", async () => {
    const context = await createTestContext("cli-history");

    try {
      initGitRepo(context.projectDir);
      await runCli(["init"]);

      const presetModel = await import("../../src/models/preset.ts");
      const projectModel = await import("../../src/models/project.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const snapshotModel = await import("../../src/models/snapshot.ts");
      const git = await import("../../src/services/git.ts");

      const preset = presetModel.createPreset({ name: "history-preset" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "history",
          content: "# Original instructions",
        }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      await runCli([
        "apply",
        "history-preset",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
      ]);

      writeFileSync(`${context.projectDir}/CLAUDE.md`, "# Modified", "utf-8");

      const history = await runCli([
        "history",
        "--project",
        context.projectDir,
      ]);
      expect(history.stdout).toContain("Before applying: history-preset");

      const project = projectModel.getProjectByOrigin(
        git.normalizeGitUrl("git@github.com:acme/skilldeck-history.git"),
      );
      expect(project).toBeDefined();
      if (!project) {
        throw new Error("Expected history project to be tracked");
      }

      const snapshot = snapshotModel.listSnapshots(project.id)[0];
      expect(snapshot).toBeDefined();
      if (!snapshot) {
        throw new Error("Expected a snapshot to be available for revert");
      }

      await runCli(["revert", snapshot.id]);

      expect(readFileSync(`${context.projectDir}/CLAUDE.md`, "utf-8")).toBe(
        "# Original instructions",
      );
    } finally {
      await context.cleanup();
    }
  });
});
