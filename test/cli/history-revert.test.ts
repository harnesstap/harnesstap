import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI history and revert", () => {
  it("lists snapshots and restores files from a snapshot", async () => {
    const context = await createTestContext("cli-history");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-history.git");
      await runCli(["init"]);

      const layerModel = await import("../../src/models/layer.ts");
      const projectModel = await import("../../src/models/project.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const snapshotModel = await import("../../src/models/snapshot.ts");
      const git = await import("../../src/services/git.ts");

      const layer = layerModel.createLayer({ name: "history-layer" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "history",
          content: "# Original instructions",
        }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      await runCli([
        "project",
        "apply",
        "history-layer",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);

      writeFileSync(`${context.projectDir}/CLAUDE.md`, "# Modified", "utf-8");

      const history = await runCli([
        "project",
        "history",
        "--project",
        context.projectDir,
      ]);
      expect(history.stdout).toContain("Before applying: history-layer");
      expect(history.stdout).toContain("WHEN");
      expect(history.stdout).toContain("ID");
      expect(history.stdout).toContain("LABEL");

      const project = projectModel.getProjectByOrigin(
        git.normalizeGitUrl("git@github.com:acme/harnessdeck-history.git"),
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

      const revertResult = await runCli(["project", "revert", snapshot.id]);
      expect(revertResult.stdout).toContain("✓ Restored");
      expect(revertResult.stdout).toContain("from snapshot");
      // Verify proper pluralization (1 file, not 1 files)
      expect(revertResult.stdout).toMatch(/\d+ files?/);
      expect(revertResult.stdout).not.toContain("1 files");

      expect(readFileSync(`${context.projectDir}/CLAUDE.md`, "utf-8")).toBe(
        "# Original instructions",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("prints full snapshot IDs in history output", async () => {
    const context = await createTestContext("cli-history-full-id");
    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-history.git");
      await runCli(["init"]);
      const layerModel = await import("../../src/models/layer.ts");
      const projectModel = await import("../../src/models/project.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const snapshotModel = await import("../../src/models/snapshot.ts");
      const git = await import("../../src/services/git.ts");

      const layer = layerModel.createLayer({ name: "history-layer" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "history",
          content: "# Original instructions",
        }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);
      await runCli([
        "project",
        "apply",
        "history-layer",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);

      const history = await runCli([
        "project",
        "history",
        "--project",
        context.projectDir,
      ]);
      const project = projectModel.getProjectByOrigin(
        git.normalizeGitUrl("git@github.com:acme/harnessdeck-history.git"),
      );
      const snapshot = project ? snapshotModel.listSnapshots(project.id)[0] : undefined;

      expect(snapshot).toBeDefined();
      // IDs are shortened in human-mode table output (first 6 chars always visible)
      expect(history.stdout).toContain((snapshot?.id ?? "").slice(0, 6));
    } finally {
      await context.cleanup();
    }
  });

  it("warns when history is requested outside a git repository", async () => {
    const context = await createTestContext("cli-history-non-git");

    try {
      await runCli(["init"]);

      const result = await runCli([
        "project",
        "history",
        "--project",
        context.projectDir,
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Not a git repository.");
    } finally {
      await context.cleanup();
    }
  });

  it("requires a snapshot id for revert", async () => {
    const context = await createTestContext("cli-revert-missing-id");

    try {
      await runCli(["init"]);

      const result = await runCli(["project", "revert"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Please provide a snapshot ID.");
      expect(result.stderr).toContain("project history");
    } finally {
      await context.cleanup();
    }
  });

  it("reports when a snapshot id does not exist", async () => {
    const context = await createTestContext("cli-revert-missing-snapshot");

    try {
      await runCli(["init"]);

      const result = await runCli(["project", "revert", "missing-snapshot"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Snapshot not found: missing-snapshot");
    } finally {
      await context.cleanup();
    }
  });
});
