import { describe, expect, it } from "bun:test";
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
          layers: [],
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

  it("stores and retrieves harness_files state", async () => {
    const context = await createInitializedTestContext("snapshot-harness");

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
        label: "Harness snapshot",
        state: {
          layers: [],
          resources: [],
          harness_files: {
            "claude-code": {
              "CLAUDE.md": "# Harness content",
            },
          },
        },
      });

      expect(snapshotModel.getSnapshot(snapshot.id)?.state.harness_files).toEqual({
        "claude-code": {
          "CLAUDE.md": "# Harness content",
        },
      });
    } finally {
      await context.cleanup();
    }
  });

  it("returns undefined for non-existent snapshot", async () => {
    const context = await createInitializedTestContext("snapshot-not-found");

    try {
      const snapshotModel = await import("../../src/models/snapshot.ts");
      expect(snapshotModel.getSnapshot("non-existent-id")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("returns empty list for project with no snapshots", async () => {
    const context = await createInitializedTestContext("snapshot-empty");

    try {
      const projectModel = await import("../../src/models/project.ts");
      const snapshotModel = await import("../../src/models/snapshot.ts");

      const project = projectModel.createProject({
        git_origin: "git@github.com:empty/repo.git",
        name: "empty/repo",
        local_path: context.projectDir,
      });

      expect(snapshotModel.listSnapshots(project.id)).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("returns empty list when no snapshots exist at all", async () => {
    const context = await createInitializedTestContext("snapshot-no-snapshots");

    try {
      const snapshotModel = await import("../../src/models/snapshot.ts");
      // Use any string as project_id since no projects exist
      expect(snapshotModel.listSnapshots("any-id")).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("lists snapshots in reverse chronological order", async () => {
    const context = await createInitializedTestContext("snapshot-order");

    try {
      const projectModel = await import("../../src/models/project.ts");
      const snapshotModel = await import("../../src/models/snapshot.ts");

      const project = projectModel.createProject({
        git_origin: "git@github.com:acme/repo.git",
        name: "acme/repo",
        local_path: context.projectDir,
      });

      snapshotModel.createSnapshot({
        project_id: project.id,
        label: "First",
        state: { layers: [], resources: [], platform_files: {} },
      });

      await new Promise((r) => setTimeout(r, 10));

      snapshotModel.createSnapshot({
        project_id: project.id,
        label: "Second",
        state: { layers: [], resources: [], platform_files: {} },
      });

      const snapshots = snapshotModel.listSnapshots(project.id);
      expect(snapshots[0]?.label).toBe("Second");
      expect(snapshots[1]?.label).toBe("First");
    } finally {
      await context.cleanup();
    }
  });
});
