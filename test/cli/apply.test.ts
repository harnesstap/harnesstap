import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

function seedClaudePluginMismatchFixture(homeDir: string, projectDir: string): void {
  mkdirSync(join(homeDir, ".claude/plugins/CACHE/formatter/.claude-plugin"), {
    recursive: true,
  });
  writeFileSync(
    join(homeDir, ".claude/plugins/CACHE/formatter/.claude-plugin/plugin.json"),
    JSON.stringify({
      name: "formatter",
      version: "1.9.0",
      description: "Formatter plugin test stub",
    }),
    "utf-8",
  );
  writeFileSync(
    join(homeDir, ".claude/plugins/installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "formatter@acme-marketplace": [
          {
            scope: "project",
            installPath: "CACHE/formatter",
            version: "1.9.0",
          },
        ],
      },
    }),
    "utf-8",
  );

  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  writeFileSync(
    join(projectDir, ".claude/settings.json"),
    JSON.stringify({
      enabledPlugins: {
        "formatter@acme-marketplace": true,
      },
    }),
    "utf-8",
  );
}

describe("CLI apply", () => {
  it("supports dry-run output and writes files plus snapshot state", async () => {
    const context = await createTestContext("cli-apply");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-apply.git");
      await runCli(["init"]);

      const presetModel = await import("../../src/models/preset.ts");
      const projectModel = await import("../../src/models/project.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const snapshotModel = await import("../../src/models/snapshot.ts");
      const preset = presetModel.createPreset({ name: "applied" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "project-context",
          content: "# Applied instructions",
        }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const dryRun = await runCli([
        "project",
        "apply",
        "applied",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
        "--dry-run",
      ]);

      expect(dryRun.stdout).toContain("CLAUDE.md");

      const applyResult = await runCli([
        "project",
        "apply",
        "applied",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
      ]);

      const project = projectModel.getProjectByOrigin(
        "git@github.com:acme/harnessdeck-apply.git",
      );

      expect(applyResult.stdout).toContain("claude-code");
      expect(applyResult.stdout).toContain("wrote 1 file");
      expect(applyResult.stdout).toContain("CLAUDE.md");
      expect(existsSync(`${context.projectDir}/CLAUDE.md`)).toBe(true);
      expect(project).toBeDefined();
      if (!project) {
        throw new Error("Expected applied project to be tracked");
      }
      expect(snapshotModel.listSnapshots(project.id)).toHaveLength(2);
    } finally {
      await context.cleanup();
    }
  });

  it("warns on stderr for preset plugin constraint mismatch without failing", async () => {
    const context = await createTestContext("cli-apply-plugins-warn");

    try {
      seedClaudePluginMismatchFixture(context.homeDir, context.projectDir);
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-plugins.git");
      await runCli(["init"]);

      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginModel = await import("../../src/models/plugin.ts");

      const preset = presetModel.createPreset({ name: "with-plugins" });
      pluginModel.addPluginToPreset(preset.id, "formatter@acme-marketplace", ">=2.1.0 <3.0.0");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "ctx",
          content: "# Ctx",
        }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const applyResult = await runCli([
        "project",
        "apply",
        "with-plugins",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
      ]);

      expect(applyResult.stderr).toContain("Plugin version mismatch:");
      expect(applyResult.stderr).toContain("formatter@acme-marketplace");
      expect(applyResult.stderr).toContain("1.9.0");
      expect(applyResult.exitCode ?? 0).toBe(0);
    } finally {
      await context.cleanup();
    }
  });

  it("exits with code 2 when --strict-plugin-versions and pinned plugin mismatches", async () => {
    const context = await createTestContext("cli-apply-plugins-strict");

    try {
      seedClaudePluginMismatchFixture(context.homeDir, context.projectDir);
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-strict.git");
      await runCli(["init"]);

      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginModel = await import("../../src/models/plugin.ts");

      const preset = presetModel.createPreset({ name: "strict-plugins" });
      pluginModel.addPluginToPreset(preset.id, "formatter@acme-marketplace", ">=2.1.0 <3.0.0");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "ctx",
          content: "# Ctx",
        }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const applyResult = await runCli([
        "project",
        "apply",
        "strict-plugins",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
        "--strict-plugin-versions",
      ]);

      expect(applyResult.exitCode).toBe(2);
      expect(applyResult.stderr).toContain("Plugin version mismatch:");
      // Files must NOT have been written — strict mode aborts before any write.
      expect(existsSync(`${context.projectDir}/CLAUDE.md`)).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("skips version validation when --ignore-plugin-versions is set", async () => {
    const context = await createTestContext("cli-apply-plugins-ignore");

    try {
      seedClaudePluginMismatchFixture(context.homeDir, context.projectDir);
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-ignore.git");
      await runCli(["init"]);

      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginModel = await import("../../src/models/plugin.ts");

      const preset = presetModel.createPreset({ name: "ignore-plugins" });
      pluginModel.addPluginToPreset(preset.id, "formatter@acme-marketplace", ">=2.1.0 <3.0.0");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "ctx",
          content: "# Ctx",
        }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const applyResult = await runCli([
        "project",
        "apply",
        "ignore-plugins",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
        "--ignore-plugin-versions",
      ]);

      expect(applyResult.stderr).not.toContain("Plugin version mismatch:");
      expect(applyResult.exitCode ?? 0).toBe(0);
    } finally {
      await context.cleanup();
    }
  });

  it("reuses imported presets when reapplying the same bundle path", async () => {
    const context = await createTestContext("cli-apply-bundle-reuse");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-bundle-reuse.git");
      await runCli(["init"]);

      const bundlePath = join(context.projectDir, "bundle.jsonc");
      writeFileSync(
        bundlePath,
        `{
  "$schema": "urn:harnessdeck:bundle:v1",
  "version": 1,
  "preset": {
    "name": "bundle-reuse",
    "version": "1.0.0",
    "description": "",
    "tags": []
  },
  "resources": [
    {
      "type": "instruction",
      "name": "ctx",
      "description": "",
      "content": "# Reusable",
      "metadata": {}
    }
  ],
  "plugins": [],
  "embedded_plugins": []
}`,
        "utf-8",
      );

      const firstApply = await runCli([
        "project",
        "apply",
        bundlePath,
        "--project",
        context.projectDir,
        "--platform",
        "codex",
      ]);
      const secondApply = await runCli([
        "project",
        "apply",
        bundlePath,
        "--project",
        context.projectDir,
        "--platform",
        "codex",
      ]);

      expect(firstApply.exitCode).toBeUndefined();
      expect(secondApply.exitCode).toBeUndefined();

      const presetModel = await import("../../src/models/preset.ts");
      const presets = presetModel
        .listPresets()
        .filter((preset) => preset.name === "bundle-reuse" && preset.version === "1.0.0");
      expect(presets).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });

  it("validates merged plugin pins from earlier presets in strict mode", async () => {
    const context = await createTestContext("cli-apply-plugins-merged-strict");

    try {
      seedClaudePluginMismatchFixture(context.homeDir, context.projectDir);
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-merged-strict.git");
      await runCli(["init"]);

      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginModel = await import("../../src/models/plugin.ts");

      const base = presetModel.createPreset({ name: "base-plugins" });
      pluginModel.addPluginToPreset(base.id, "formatter@acme-marketplace", ">=2.1.0 <3.0.0");
      const baseResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "base",
          content: "# Base",
        }),
      );
      presetModel.addResourceToPreset(base.id, baseResource.id);

      const overlay = presetModel.createPreset({ name: "overlay-no-plugins" });
      const overlayResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "overlay",
          content: "# Overlay",
        }),
      );
      presetModel.addResourceToPreset(overlay.id, overlayResource.id);

      const applyResult = await runCli([
        "project",
        "apply",
        "base-plugins",
        "overlay-no-plugins",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
        "--strict-plugin-versions",
      ]);

      expect(applyResult.exitCode).toBe(2);
      expect(applyResult.stderr).toContain("Plugin version mismatch:");
      expect(existsSync(`${context.projectDir}/CLAUDE.md`)).toBe(false);
    } finally {
      await context.cleanup();
    }
  });
});
