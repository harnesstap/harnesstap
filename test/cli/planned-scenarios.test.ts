import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, spyOn } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";

describe("CLI planned scenarios", () => {
  it("runs layer doctor, diff, and from-project", async () => {
    const context = await createTestContext("cli-planned");
    try {
      await runCli(["init"]);
      mkdirSync(join(context.projectDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.projectDir, "CLAUDE.md"),
        "# CLI layer from project\n",
        "utf-8",
      );

      const fromProject = await runCli([
        "layer",
        "from-project",
        "cli-inferred",
        "--project",
        context.projectDir,
      ]);
      expect(fromProject.stdout).toContain("✓ Created layer");
      expect(fromProject.stdout).toContain("cli-inferred");
      // Verify proper pluralization (1 resource, not 1 resources)
      expect(fromProject.stdout).toMatch(/\d+ resources?/);
      expect(fromProject.stdout).not.toContain("1 resources");

      const doctor = await runCli([
        "layer",
        "doctor",
        "cli-inferred",
        "--format",
        "json",
      ]);
      expect(doctor.stdout).toContain('"results"');

      await runCli(["layer", "create", "other"]);
      const diff = await runCli([
        "layer",
        "diff",
        "cli-inferred",
        "other",
        "--format",
        "json",
      ]);
      expect(diff.stdout).toContain('"changes"');
    } finally {
      await context.cleanup();
    }
  });

  it("auto-prompts layer from-project on a TTY when the layer name is missing", async () => {
    const context = await createTestContext("cli-from-project-wizard");
    try {
      await runCli(["init"]);
      mkdirSync(join(context.projectDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.projectDir, "CLAUDE.md"),
        "# CLI layer from project\n",
        "utf-8",
      );

      const result = await runCli([
        "layer",
        "from-project",
        "--project",
        context.projectDir,
      ], {
        isTTY: true,
        promptResponses: [{ value: "wizard-layer" }],
      });

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("wizard-layer");
    } finally {
      await context.cleanup();
    }
  });

  it("keeps layer from-project non-interactive when json or CI suppress prompting", async () => {
    const context = await createTestContext("cli-from-project-wizard-suppressed");
    try {
      await runCli(["init"]);

      const jsonSuppressed = await runCli([
        "layer",
        "from-project",
        "--project",
        context.projectDir,
        "--format",
        "json",
      ], {
        isTTY: true,
      });
      expect(jsonSuppressed.exitCode).toBe(1);

      const ciSuppressed = await runCli([
        "layer",
        "from-project",
        "--project",
        context.projectDir,
      ], {
        isTTY: true,
        env: { CI: "true" },
      });
      expect(ciSuppressed.exitCode).toBe(1);
    } finally {
      await context.cleanup();
    }
  });

  it("layer from-project excludes ignored resources", async () => {
    const context = await createTestContext("cli-from-project-ignore");
    try {
      await runCli(["init"]);
      mkdirSync(join(context.projectDir, ".claude"), { recursive: true });
      writeFileSync(join(context.projectDir, "CLAUDE.md"), "# Keep me\n", "utf-8");
      writeFileSync(join(context.projectDir, "AGENTS.md"), "# Ignore me\n", "utf-8");
      writeFileSync(
        join(context.projectDir, ".harnessdeckignore"),
        "AGENTS.md\n",
        "utf-8",
      );

      const result = await runCli([
        "layer",
        "from-project",
        "cli-inferred",
        "--project",
        context.projectDir,
      ]);

      expect(result.stdout).toContain("cli-inferred");

      const layerModel = await import("../../src/models/layer.ts");
      const layer = layerModel.getLayer("cli-inferred");
      if (!layer) throw new Error("Expected cli-inferred layer");

      const resources = layerModel.getLayerResources(layer.id);
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

  it("runs project drift and sync", async () => {
    const context = await createTestContext("cli-sync-drift");
    try {
      initGitRepo(context.projectDir, "git@github.com:acme/sync-drift.git");
      await runCli(["init"]);

      mkdirSync(join(context.projectDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.projectDir, "CLAUDE.md"),
        "# Main harness\n",
        "utf-8",
      );
      mkdirSync(join(context.projectDir, ".cursor"), { recursive: true });

      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const layer = layerModel.createLayer({ name: "sync-layer" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "project-context",
          namespace: "sync-layer",
          content: "# Main harness\n",
        }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      await runCli([
        "harness",
        "project",
        "set",
        "--project",
        context.projectDir,
        "--main",
        "claude-code",
        "--aliases",
        "cursor",
      ]);

      await runCli([
        "project",
        "apply",
        "sync-layer",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);

      writeFileSync(
        join(context.projectDir, "CLAUDE.md"),
        "# Edited after apply\n",
        "utf-8",
      );

      const drift = await runCli([
        "project",
        "drift",
        "--project",
        context.projectDir,
        "--format",
        "json",
      ]);
      expect(drift.stdout).toMatch(/"has_drift":\s*true/);
      expect(drift.exitCode).toBe(1);

      const driftService = await import("../../src/services/project-drift.ts");
      const driftSpy = spyOn(driftService, "detectProjectDriftFromLatest")
        .mockReturnValue({
          project_root: context.projectDir,
          snapshot_id: "snap-drift-icons",
          snapshot_label: "before",
          has_drift: true,
          changes: [
            { path: "NEW.md", type: "added", platform: "claude-code" },
            { path: "CLAUDE.md", type: "modified", platform: "claude-code" },
            { path: "OLD.md", type: "deleted", platform: "claude-code" },
          ],
        });

      const driftHuman = await runCli([
        "project",
        "drift",
        "--project",
        context.projectDir,
      ]);
      driftSpy.mockRestore();
      expect(driftHuman.stdout).toContain("DRIFT");
      expect(driftHuman.stdout).toMatch(/^\s+\+\s+added\s+NEW\.md\s+claude-code$/m);
      expect(driftHuman.stdout).toMatch(
        /^\s+~\s+modified\s+CLAUDE\.md\s+claude-code$/m,
      );
      expect(driftHuman.stdout).toMatch(/^\s+−\s+deleted\s+OLD\.md\s+claude-code$/m);
      expect(driftHuman.exitCode).toBe(1);

      const syncDry = await runCli([
        "project",
        "mirror",
        context.projectDir,
        "--dry-run",
        "--format",
        "json",
      ]);
      expect(syncDry.stdout).toContain("main_harness");

      // Human-mode sync: spinner resolves to a Synced verdict
      const syncHuman = await runCli([
        "project",
        "mirror",
        context.projectDir,
      ]);
      expect(syncHuman.stdout).toContain("Synced");
      expect(syncHuman.exitCode ?? 0).toBe(0);
    } finally {
      await context.cleanup();
    }
  });

  it("auto-prompts project apply on a TTY when layers are missing", async () => {
    const context = await createTestContext("cli-project-apply-wizard");
    try {
      initGitRepo(context.projectDir, "git@github.com:acme/apply-wizard.git");
      await runCli(["init"]);

      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const layer = layerModel.createLayer({ name: "apply-layer" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "apply-context",
          content: "# Apply wizard\n",
        }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      const result = await runCli([
        "project",
        "apply",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ], {
        isTTY: true,
        promptResponses: [{ value: "apply-layer" }],
      });

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("CLAUDE.md");
    } finally {
      await context.cleanup();
    }
  });

  it("keeps project apply non-interactive when json or no-interactive suppress prompting", async () => {
    const context = await createTestContext("cli-project-apply-wizard-suppressed");
    try {
      await runCli(["init"]);

      const jsonSuppressed = await runCli([
        "project",
        "apply",
        "--project",
        context.projectDir,
        "--format",
        "json",
      ], {
        isTTY: true,
      });
      expect(jsonSuppressed.exitCode).toBe(1);

      const disabled = await runCli([
        "--no-interactive",
        "project",
        "apply",
        "--project",
        context.projectDir,
      ], {
        isTTY: true,
      });
      expect(disabled.exitCode).toBe(1);
    } finally {
      await context.cleanup();
    }
  });

  it("resource delete without prompting fails as a normal CLI error", async () => {
    const context = await createTestContext("cli-resource-delete-no-prompt");
    try {
      const result = await runCli(["--no-interactive", "resource", "delete"], {
        isTTY: true,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Resource name is required");
      expect(result.stderr).not.toContain("Error:");
      expect(result.stderr).not.toContain("at ");
    } finally {
      await context.cleanup();
    }
  });

  it("uses the invoked alias in drift json guidance when no project record exists", async () => {
    const context = await createTestContext("cli-drift-hd-guidance");
    try {
      initGitRepo(context.projectDir, "git@github.com:acme/drift-hd-guidance.git");
      await runCli(["init"], { commandName: "hd" });

      const result = await runCli(
        [
          "project",
          "drift",
          "--project",
          context.projectDir,
          "--format",
          "json",
        ],
        { commandName: "hd" },
      );

      expect(result.stdout).toContain('"message": "No project record. Run hd project apply first."');
    } finally {
      await context.cleanup();
    }
  });

  it("runs migrate export as json", async () => {
    const context = await createTestContext("cli-migrate");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "m1"]);
      const out = join(context.rootDir, "migrate.json");
      const result = await runCli([
        "migrate",
        "export",
        out,
        "--format",
        "json",
      ]);
      const output = result.stdout || result.stderr;
      expect(output).toMatch(/layer_count/);
    } finally {
      await context.cleanup();
    }
  });
});
