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

      const layerModel = await import("../../src/models/layer.ts");
      const projectModel = await import("../../src/models/project.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const snapshotModel = await import("../../src/models/snapshot.ts");
      const layer = layerModel.createLayer({ name: "applied" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "project-context",
          content: "# Applied instructions",
        }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

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

  it("warns on stderr for layer plugin constraint mismatch without failing", async () => {
    const context = await createTestContext("cli-apply-plugins-warn");

    try {
      seedClaudePluginMismatchFixture(context.homeDir, context.projectDir);
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-plugins.git");
      await runCli(["init"]);

      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginModel = await import("../../src/models/plugin.ts");

      const layer = layerModel.createLayer({ name: "with-plugins" });
      pluginModel.addPluginToLayer(layer.id, "formatter@acme-marketplace", ">=2.1.0 <3.0.0");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "ctx",
          content: "# Ctx",
        }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

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

      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginModel = await import("../../src/models/plugin.ts");

      const layer = layerModel.createLayer({ name: "strict-plugins" });
      pluginModel.addPluginToLayer(layer.id, "formatter@acme-marketplace", ">=2.1.0 <3.0.0");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "ctx",
          content: "# Ctx",
        }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

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

      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginModel = await import("../../src/models/plugin.ts");

      const layer = layerModel.createLayer({ name: "ignore-plugins" });
      pluginModel.addPluginToLayer(layer.id, "formatter@acme-marketplace", ">=2.1.0 <3.0.0");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "ctx",
          content: "# Ctx",
        }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

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

  it("rejects combining --strict-plugin-versions and --ignore-plugin-versions", async () => {
    const context = await createTestContext("cli-apply-plugins-conflict");

    try {
      seedClaudePluginMismatchFixture(context.homeDir, context.projectDir);
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-conflict.git");
      await runCli(["init"]);

      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginModel = await import("../../src/models/plugin.ts");

      const layer = layerModel.createLayer({ name: "conflict-plugins" });
      pluginModel.addPluginToLayer(
        layer.id,
        "formatter@acme-marketplace",
        ">=2.1.0 <3.0.0",
      );
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "ctx",
          content: "# Ctx",
        }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      const applyResult = await runCli([
        "project",
        "apply",
        "conflict-plugins",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
        "--strict-plugin-versions",
        "--ignore-plugin-versions",
      ]);

      expect(applyResult.exitCode).toBe(1);
      expect(applyResult.stderr).toContain(
        "Choose either --strict-plugin-versions or --ignore-plugin-versions, not both.",
      );
      expect(existsSync(`${context.projectDir}/CLAUDE.md`)).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("applies successfully in a non-git project without tracking snapshot state", async () => {
    const context = await createTestContext("cli-apply-non-git");

    try {
      await runCli(["init"]);

      const layerModel = await import("../../src/models/layer.ts");
      const projectModel = await import("../../src/models/project.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const layer = layerModel.createLayer({ name: "non-git-apply" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "ctx",
          content: "# Non-git",
        }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      const applyResult = await runCli([
        "project",
        "apply",
        "non-git-apply",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
      ]);

      expect(applyResult.stdout).toContain("claude-code");
      expect(existsSync(`${context.projectDir}/CLAUDE.md`)).toBe(true);
      expect(projectModel.listProjects()).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("reuses imported layers when reapplying the same bundle path", async () => {
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
  "layer": {
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

      const layerModel = await import("../../src/models/layer.ts");
      const layers = layerModel
        .listLayers()
        .filter((layer) => layer.name === "bundle-reuse" && layer.version === "1.0.0");
      expect(layers).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });

  it("validates merged plugin pins from earlier layers in strict mode", async () => {
    const context = await createTestContext("cli-apply-plugins-merged-strict");

    try {
      seedClaudePluginMismatchFixture(context.homeDir, context.projectDir);
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-merged-strict.git");
      await runCli(["init"]);

      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginModel = await import("../../src/models/plugin.ts");

      const base = layerModel.createLayer({ name: "base-plugins" });
      pluginModel.addPluginToLayer(base.id, "formatter@acme-marketplace", ">=2.1.0 <3.0.0");
      const baseResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "base",
          content: "# Base",
        }),
      );
      layerModel.addResourceToLayer(base.id, baseResource.id);

      const overlay = layerModel.createLayer({ name: "overlay-no-plugins" });
      const overlayResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "overlay",
          content: "# Overlay",
        }),
      );
      layerModel.addResourceToLayer(overlay.id, overlayResource.id);

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
