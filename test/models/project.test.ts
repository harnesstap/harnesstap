import { describe, expect, it } from "bun:test";
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

  it("records applied layers with platforms", async () => {
    const context = await createInitializedTestContext("project-layers");

    try {
      const projectModel = await import("../../src/models/project.ts");
      const layerModel = await import("../../src/models/layer-model.ts");

      const project = projectModel.createProject({
        git_origin: "git@github.com:acme/repo.git",
        name: "acme/repo",
        local_path: "/tmp/repo",
      });
      const layer = layerModel.createLayer({ name: "starter" });
      const configuredLayerModel = await import("../../src/models/layer-model.ts");
      const configuredLayer = configuredLayerModel.createLayerFromSources({
        name: "starter-stack",
        sourceLayerIds: [layer.id],
      });

      projectModel.applyConfiguredLayerToProject({
        project_id: project.id,
        configured_layer_id: configuredLayer.id,
        platforms: ["claude-code", "cursor"],
      });

      expect(projectModel.getProjectConfiguredLayers(project.id)).toEqual([
        expect.objectContaining({
          project_id: project.id,
          layer_id: configuredLayer.id,
          platforms: ["claude-code", "cursor"],
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
