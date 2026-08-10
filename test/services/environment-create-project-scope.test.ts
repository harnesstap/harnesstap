import { describe, expect, it } from "bun:test";
import { createPlugin, createPluginFromSources } from "../../src/models/plugin-model.js";
import { createProject, applyPluginToProject } from "../../src/models/project.js";
import { createInitializedTestContext } from "../helpers/db.ts";
import { inspectProjectPluginScope } from "../../src/services/wizards/environment-create-project-scope.ts";

describe("inspectProjectPluginScope", () => {
  it("reports untracked directories", async () => {
    const context = await createInitializedTestContext("project-scope-untracked");

    try {
      const inspection = inspectProjectPluginScope(context.projectDir);
      expect(inspection).toEqual({
        kind: "untracked",
        projectRoot: context.projectDir,
      });
    } finally {
      await context.cleanup();
    }
  });

  it("reports tracked projects without applied plugins", async () => {
    const context = await createInitializedTestContext("project-scope-empty");

    try {
      createProject({
        git_origin: "https://github.com/example/empty.git",
        name: "empty",
        local_path: context.projectDir,
      });

      const inspection = inspectProjectPluginScope(context.projectDir);
      expect(inspection).toEqual({
        kind: "no_applied_plugins",
        projectRoot: context.projectDir,
      });
    } finally {
      await context.cleanup();
    }
  });

  it("lists applied plugin selectors for tracked projects", async () => {
    const context = await createInitializedTestContext("project-scope-applied");

    try {
      const plugin = createPlugin({ name: "scope-plugin" });
      const configuredPlugin = createPluginFromSources({
        name: "scope-plugin",
        sourcePluginIds: [plugin.id],
      });
      const project = createProject({
        git_origin: "https://github.com/example/applied.git",
        name: "applied",
        local_path: context.projectDir,
      });
      applyPluginToProject({
        project_id: project.id,
        plugin_id: configuredPlugin.id,
        platforms: ["claude-code"],
      });

      const inspection = inspectProjectPluginScope(context.projectDir);
      expect(inspection).toEqual({
        kind: "applied",
        projectRoot: context.projectDir,
        selectors: [`scope-plugin@${configuredPlugin.version}`],
        labels: [`scope-plugin@${configuredPlugin.version}`],
      });
    } finally {
      await context.cleanup();
    }
  });
});
