import { describe, expect, it } from "bun:test";
import { createLayer, createLayerFromSources } from "../../src/models/plugin-model.js";
import { createProject, applyLayerToProject } from "../../src/models/project.js";
import { createInitializedTestContext } from "../helpers/db.ts";
import { inspectProjectLayerScope } from "../../src/services/wizards/environment-create-project-scope.ts";

describe("inspectProjectLayerScope", () => {
  it("reports untracked directories", async () => {
    const context = await createInitializedTestContext("project-scope-untracked");

    try {
      const inspection = inspectProjectLayerScope(context.projectDir);
      expect(inspection).toEqual({
        kind: "untracked",
        projectRoot: context.projectDir,
      });
    } finally {
      await context.cleanup();
    }
  });

  it("reports tracked projects without applied layers", async () => {
    const context = await createInitializedTestContext("project-scope-empty");

    try {
      createProject({
        git_origin: "https://github.com/example/empty.git",
        name: "empty",
        local_path: context.projectDir,
      });

      const inspection = inspectProjectLayerScope(context.projectDir);
      expect(inspection).toEqual({
        kind: "no_applied_layers",
        projectRoot: context.projectDir,
      });
    } finally {
      await context.cleanup();
    }
  });

  it("lists applied layer selectors for tracked projects", async () => {
    const context = await createInitializedTestContext("project-scope-applied");

    try {
      const plugin = createLayer({ name: "scope-plugin" });
      const configuredLayer = createLayerFromSources({
        name: "scope-layer",
        sourceLayerIds: [plugin.id],
      });
      const project = createProject({
        git_origin: "https://github.com/example/applied.git",
        name: "applied",
        local_path: context.projectDir,
      });
      applyLayerToProject({
        project_id: project.id,
        layer_id: configuredLayer.id,
        platforms: ["claude-code"],
      });

      const inspection = inspectProjectLayerScope(context.projectDir);
      expect(inspection).toEqual({
        kind: "applied",
        projectRoot: context.projectDir,
        selectors: [`scope-layer@${configuredLayer.version}`],
        labels: [`scope-layer@${configuredLayer.version}`],
      });
    } finally {
      await context.cleanup();
    }
  });
});
