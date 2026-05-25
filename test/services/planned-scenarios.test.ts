import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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

      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const snapshotModel = await import("../../src/models/snapshot.ts");
      const projectModel = await import("../../src/models/project.ts");
      const drift = await import("../../src/services/project-drift.ts");
      const applier = await import("../../src/services/applier.ts");

      const preset = presetModel.createPreset({ name: "drift-test" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "project-context",
          content: "# Original\n",
        }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

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
          presets: [preset],
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

  it("diffs two presets", async () => {
    const context = await createInitializedTestContext("diff");
    try {
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const { diffPresets } = await import("../../src/services/preset-diff.ts");

      const a = presetModel.createPreset({ name: "base" });
      const b = presetModel.createPreset({ name: "fork" });
      const r1 = resourceModel.createResource(
        makeResourceInput({ type: "instruction", name: "ctx", content: "a" }),
      );
      const r2 = resourceModel.createResource(
        makeResourceInput({ type: "instruction", name: "ctx", content: "b" }),
      );
      presetModel.addResourceToPreset(a.id, r1.id);
      presetModel.addResourceToPreset(b.id, r2.id);

      const report = diffPresets("base", "fork");
      expect(report.changes.some((c) => c.key === "instruction:ctx")).toBe(true);
      // renderer fields: change.kind, change.change used by renderChangeList
      const modifiedCtx = report.changes.find((c) => c.key === "instruction:ctx");
      expect(modifiedCtx?.kind).toBe("resource");
      expect(modifiedCtx?.change).toBe("modified");
    } finally {
      await context.cleanup();
    }
  });

  it("validates preset and reports missing resources as warning only when empty", async () => {
    const context = await createInitializedTestContext("validate");
    try {
      const presetModel = await import("../../src/models/preset.ts");
      const { validatePreset } = await import(
        "../../src/services/preset-validate.ts"
      );

      presetModel.createPreset({ name: "empty-one" });
      const report = validatePreset("empty-one");
      expect(report.issues.some((i) => i.code === "empty_preset")).toBe(true);
      expect(report.valid).toBe(true);
      // renderer fields: severity, code, message used by ui.table in handlePresetValidateCommand
      const emptyIssue = report.issues.find((i) => i.code === "empty_preset");
      expect(emptyIssue?.severity).toBe("warning");
      expect(emptyIssue?.message).toBeTruthy();
    } finally {
      await context.cleanup();
    }
  });

  it("creates preset from project scan", async () => {
    const context = await createInitializedTestContext("from-project");
    try {
      mkdirSync(join(context.projectDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.projectDir, "CLAUDE.md"),
        "# From project\n",
        "utf-8",
      );

      const { createPresetFromProject } = await import(
        "../../src/services/preset-from-project.ts"
      );
      const presetModel = await import("../../src/models/preset.ts");

      const result = await createPresetFromProject({
        name: "from-proj",
        projectRoot: context.projectDir,
      });
      expect(result.imported_count).toBeGreaterThan(0);
      const resources = presetModel.getPresetResources(result.preset.id);
      expect(resources.length).toBeGreaterThan(0);
    } finally {
      await context.cleanup();
    }
  });

  it("exports and imports migration state", async () => {
    const context = await createInitializedTestContext("migrate");
    try {
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const harnessModel = await import("../../src/models/harness.ts");
      const migrate = await import("../../src/services/migrate.ts");

      const preset = presetModel.createPreset({ name: "migrate-me" });
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "instruction", name: "m", content: "x" }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);
      harnessModel.setHarnessPreference({
        main_harness: "claude-code",
        alias_harnesses: ["cursor"],
      });

      const archivePath = join(context.rootDir, "state.json");
      const exported = migrate.exportMigrationState({
        outputPath: archivePath,
        includePlugins: false,
      });
      expect(exported.preset_count).toBe(1);
      expect(existsSync(archivePath)).toBe(true);

      context.connection.closeDb();
      const context2 = await createInitializedTestContext("migrate-import");
      try {
        migrate.importMigrationState({ archivePath });
        expect(presetModel.getPreset("migrate-me")).toBeDefined();
        expect(harnessModel.getHarnessPreference()?.main_harness).toBe(
          "claude-code",
        );
      } finally {
        await context2.cleanup();
      }
    } finally {
      await context.cleanup();
    }
  });
});
