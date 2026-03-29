import { describe, expect, it } from "vitest";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("snapshot model", () => {
  it("stores and retrieves snapshot state", async () => {
    const context = await createInitializedTestContext("snapshot-model");

    try {
      const projectModel = await import("../../src/models/project.ts");
      const snapshotModel = await import("../../src/models/snapshot.ts");

      const project = projectModel.createProject({
        git_origin: "git@github.com:acme/repo.git",
        name: "acme/repo",
        local_path: context.projectDir,
      });

      const snapshot = snapshotModel.createSnapshot({
        project_id: project.id,
        label: "Before apply",
        state: {
          presets: [],
          resources: [],
          platform_files: {
            "claude-code": {
              "CLAUDE.md": "# Hello",
            },
          },
        },
      });

      expect(snapshotModel.getSnapshot(snapshot.id)?.state.platform_files).toEqual({
        "claude-code": {
          "CLAUDE.md": "# Hello",
        },
      });
      expect(snapshotModel.listSnapshots(project.id)[0]?.id).toBe(snapshot.id);
    } finally {
      await context.cleanup();
    }
  });
});
