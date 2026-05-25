import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";

describe("CLI planned scenarios", () => {
  it("runs preset validate, diff, and from-project", async () => {
    const context = await createTestContext("cli-planned");
    try {
      await runCli(["init"]);
      mkdirSync(join(context.projectDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.projectDir, "CLAUDE.md"),
        "# CLI preset from project\n",
        "utf-8",
      );

      const fromProject = await runCli([
        "preset",
        "from-project",
        "cli-inferred",
        "--project",
        context.projectDir,
      ]);
      expect(fromProject.stdout).toContain("✓ Created preset");
      expect(fromProject.stdout).toContain("cli-inferred");
      // Verify proper pluralization (1 resource, not 1 resources)
      expect(fromProject.stdout).toMatch(/\d+ resources?/);
      expect(fromProject.stdout).not.toContain("1 resources");

      const validate = await runCli([
        "preset",
        "validate",
        "cli-inferred",
        "--format",
        "json",
      ]);
      expect(validate.stdout).toContain('"valid"');

      await runCli(["preset", "create", "other"]);
      const diff = await runCli([
        "preset",
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

      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const preset = presetModel.createPreset({ name: "sync-preset" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "project-context",
          content: "# Main harness\n",
        }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

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
        "sync-preset",
        "--project",
        context.projectDir,
        "--platform",
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
      const driftSpy = vi
        .spyOn(driftService, "detectProjectDriftFromLatest")
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
        "sync",
        context.projectDir,
        "--dry-run",
        "--format",
        "json",
      ]);
      expect(syncDry.stdout).toContain("main_harness");

      // Human-mode sync: spinner resolves to a Synced verdict
      const syncHuman = await runCli([
        "project",
        "sync",
        context.projectDir,
      ]);
      expect(syncHuman.stdout).toContain("Synced");
      expect(syncHuman.exitCode ?? 0).toBe(0);
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
      await runCli(["preset", "create", "m1"]);
      const out = join(context.rootDir, "migrate.json");
      const result = await runCli([
        "migrate",
        "export",
        out,
        "--format",
        "json",
      ]);
      const output = result.stdout || result.stderr;
      expect(output).toMatch(/preset_count/);
    } finally {
      await context.cleanup();
    }
  });
});
