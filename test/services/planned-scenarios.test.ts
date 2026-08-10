import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("planned scenarios services", () => {
  it("detects project drift after manual file edit", async () => {
    const context = await createInitializedTestContext("drift");
    try {
      initGitRepo(context.projectDir, "git@github.com:acme/drift.git");
      mkdirSync(join(context.projectDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.projectDir, "CLAUDE.md"),
        "# Original\n",
        "utf-8",
      );

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const snapshotModel = await import("../../src/models/snapshot.ts");
      const projectModel = await import("../../src/models/project.ts");
      const drift = await import("../../src/services/project-drift.ts");
      const applier = await import("../../src/services/applier.ts");

      const plugin = pluginModel.createPlugin({ name: "drift-test" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "project-context",
          namespace: "drift-test",
          content: "# Original\n",
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const generated = await applier.generateFiles(
        [resource],
        ["claude-code"],
        context.projectDir,
      );
      const project = projectModel.upsertProject({
        git_origin: "github.com/acme/drift",
        name: "drift",
        local_path: context.projectDir,
      });
      snapshotModel.createSnapshot({
        project_id: project.id,
        label: "before",
        state: {
          plugins: [plugin],
          resources: [resource],
          platform_files: Object.fromEntries(
            generated.map((r) => [
              r.platformId,
              Object.fromEntries(r.files.map((f) => [f.path, f.content])),
            ]),
          ),
        },
      });

      writeFileSync(
        join(context.projectDir, "CLAUDE.md"),
        "# Hand edited\n",
        "utf-8",
      );

      const report = drift.detectProjectDriftFromLatest(
        context.projectDir,
        project.id,
      );
      expect(report?.has_drift).toBe(true);
      expect(report?.changes.some((c) => c.path === "CLAUDE.md")).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("diffs two plugins", async () => {
    const context = await createInitializedTestContext("diff");
    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const { diffPlugins } = await import("../../src/services/plugin-diff.ts");

      const a = pluginModel.createPlugin({ name: "base" });
      const b = pluginModel.createPlugin({ name: "fork" });
      const r1 = resourceModel.createResource(
        makeResourceInput({ type: "instruction", name: "ctx", namespace: "base", content: "a" }),
      );
      const r2 = resourceModel.createResource(
        makeResourceInput({ type: "instruction", name: "ctx", namespace: "fork", content: "b" }),
      );
      pluginModel.addResourceToPlugin(a.id, r1.id);
      pluginModel.addResourceToPlugin(b.id, r2.id);

      const report = diffPlugins("base", "fork");
      expect(report.changes.some((c) => c.key === "instruction:ctx@fork")).toBe(true);
      const forkCtx = report.changes.find((c) => c.key === "instruction:ctx@fork");
      expect(forkCtx?.kind).toBe("resource");
      expect(forkCtx?.change).toBe("added");
    } finally {
      await context.cleanup();
    }
  });

  it("runs doctor and reports empty plugins as warnings only", async () => {
    const context = await createInitializedTestContext("doctor");
    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const { runPluginDoctor } = await import(
        "../../src/services/plugin-doctor.ts"
      );

      pluginModel.createPlugin({ name: "empty-one" });
      const report = runPluginDoctor({ nameOrId: "empty-one" });
      const emptyPluginResult = report.results.find(
        (result) => result.check === "empty-plugin",
      );
      expect(report.valid).toBe(true);
      expect(emptyPluginResult?.severity).toBe("warn");
      expect(emptyPluginResult?.message).toMatch(/has no resources/i);
    } finally {
      await context.cleanup();
    }
  });

  it("runs plugin-metadata checks against invalid plugin refs and versions", async () => {
    const context = await createInitializedTestContext("doctor-plugin-meta");
    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const pluginPins = await import("../../src/services/plugin-composition.ts");
      const { runPluginDoctor } = await import(
        "../../src/services/plugin-doctor.ts"
      );

      const plugin = pluginModel.createPlugin({ name: "bad-plugin-meta" });
      pluginPins.attachPluginPinToPlugin(plugin.id, "formatter", "not-semver");

      const report = runPluginDoctor({
        nameOrId: "bad-plugin-meta",
        checkIds: ["plugin-metadata"],
      });

      expect(report.valid).toBe(false);
      expect(report.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            check: "plugin-metadata",
            severity: "error",
            message: "Plugin ref must include marketplace: formatter",
          }),
          expect.objectContaining({
            check: "plugin-metadata",
            severity: "error",
            message: expect.stringMatching(/invalid version constraint/i),
          }),
        ]),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("creates plugin from project scan", async () => {
    const context = await createInitializedTestContext("from-project");
    try {
      mkdirSync(join(context.projectDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.projectDir, "CLAUDE.md"),
        "# From project\n",
        "utf-8",
      );
      writeFileSync(join(context.projectDir, "AGENTS.md"), "# Ignore me\n", "utf-8");
      writeFileSync(
        join(context.projectDir, ".harnesstapignore"),
        "AGENTS.md\n",
        "utf-8",
      );

      const { createPluginFromProject } = await import(
        "../../src/services/plugin-from-project.ts"
      );
      const pluginModel = await import("../../src/models/plugin-model.ts");

      const result = await createPluginFromProject({
        name: "from-proj",
        projectRoot: context.projectDir,
      });
      expect(result.imported_count).toBeGreaterThan(0);
      const resources = pluginModel.getPluginResources(result.plugin.id);
      expect(resources.length).toBeGreaterThan(0);
      expect(resources.some((resource) => resource.source === "AGENTS.md")).toBe(
        false,
      );
      expect(resources.some((resource) => resource.source === "CLAUDE.md")).toBe(
        true,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("exports and imports migration state", async () => {
    const context = await createInitializedTestContext("migrate");
    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const harnessModel = await import("../../src/models/harness.ts");
      const environmentModel = await import("../../src/models/environment.ts");
      const migrate = await import("../../src/services/migrate.ts");

      const plugin = pluginModel.createPlugin({ name: "migrate-me" });
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "instruction", name: "m", content: "x" }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);
      const environment = environmentModel.createEnvironment({ name: "migrate-env" });
      environmentModel.upsertEnvironmentEnvVar(environment.id, "PD_REGION", "eu");
      harnessModel.setHarnessPreference({
        main_harness: "claude-code",
        alias_harnesses: ["cursor"],
      });
      mkdirSync(join(context.homeDir, ".harnesstap"), { recursive: true });
      writeFileSync(
        join(context.homeDir, ".harnesstap", "active-profile.json"),
        JSON.stringify({ name: "default" }),
        "utf-8",
      );

      const archivePath = join(context.rootDir, "state.json");
      const exported = migrate.exportMigrationState({
        outputPath: archivePath,
        includePlugins: false,
      });
      expect(exported.plugin_count).toBe(1);
      expect(exported.environment_count).toBe(1);
      expect(existsSync(archivePath)).toBe(true);

      context.connection.closeDb();
      const context2 = await createInitializedTestContext("migrate-import");
      try {
        const imported = migrate.importMigrationState({ archivePath });
        expect(imported.plugins_imported).toBe(1);
        expect(imported.environments_imported).toBe(1);
        expect(pluginModel.getPlugin("migrate-me")).toBeDefined();
        expect(environmentModel.getEnvironmentByName("migrate-env")).toBeDefined();
        expect(harnessModel.getHarnessPreference()?.main_harness).toBe(
          "claude-code",
        );
        expect(
          JSON.parse(
            readFileSync(
              join(context2.homeDir, ".harnesstap", "active-profile.json"),
              "utf-8",
            ),
          ),
        ).toEqual({ name: "default" });
      } finally {
        await context2.cleanup();
      }
    } finally {
      await context.cleanup();
    }
  });
});
