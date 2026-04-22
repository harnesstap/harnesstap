import { describe, expect, it } from "vitest";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("project model", () => {
  it("creates and upserts projects by git origin", async () => {
    const context = await createInitializedTestContext("project-model");

    try {
      const model = await import("../../src/models/project.ts");

      const project = model.createProject({
        git_origin: "git@github.com:acme/repo.git",
        name: "acme/repo",
        local_path: "/tmp/one",
      });

      const updated = model.upsertProject({
        git_origin: project.git_origin,
        name: "acme/repo-renamed",
        local_path: "/tmp/two",
      });

      expect(updated.id).toBe(project.id);
      expect(updated.name).toBe("acme/repo-renamed");
      expect(model.getProjectByOrigin(project.git_origin)?.local_path).toBe("/tmp/two");
      expect(model.listProjects()).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });

  it("records applied presets with JSON harnesses", async () => {
    const context = await createInitializedTestContext("project-presets");

    try {
      const projectModel = await import("../../src/models/project.ts");
      const presetModel = await import("../../src/models/preset.ts");

      const project = projectModel.createProject({
        git_origin: "git@github.com:acme/repo.git",
        name: "acme/repo",
        local_path: "/tmp/repo",
      });
      const preset = presetModel.createPreset({ name: "starter" });

      projectModel.applyPresetToProject({
        project_id: project.id,
        preset_id: preset.id,
        harnesses: ["claude-code", "cursor"],
      });

      expect(projectModel.getProjectPresets(project.id)).toEqual([
        expect.objectContaining({
          project_id: project.id,
          preset_id: preset.id,
          harnesses: ["claude-code", "cursor"],
        }),
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("returns undefined for non-existent project by origin", async () => {
    const context = await createInitializedTestContext("project-not-found");

    try {
      const model = await import("../../src/models/project.ts");
      expect(model.getProjectByOrigin("git@github.com:nonexistent/repo.git")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("returns undefined for non-existent project by id", async () => {
    const context = await createInitializedTestContext("project-by-id-not-found");

    try {
      const model = await import("../../src/models/project.ts");
      expect(model.getProject("non-existent-id")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("returns empty list when no projects exist", async () => {
    const context = await createInitializedTestContext("project-empty");

    try {
      const model = await import("../../src/models/project.ts");
      expect(model.listProjects()).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });
});
