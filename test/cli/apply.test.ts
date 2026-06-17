import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { writeLayerExportToml, makeSingleLayerExport } from "../helpers/transport-fixtures.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { findPluginResourceByPin } from "../../src/services/layer-composition.ts";
import { getDb } from "../../src/db/connection.ts";

function setPluginResolvedVersion(
  ref: string,
  resolvedVersion: string,
  versionConstraint?: string,
): void {
  const plugin = findPluginResourceByPin(ref, versionConstraint);
  if (!plugin) {
    throw new Error(`Plugin resource not found: ${ref}`);
  }
  const metadata = {
    ...(plugin.metadata as Record<string, unknown>),
    resolved_version: resolvedVersion,
    sync_status: "synced",
  };
  getDb()
    .prepare("UPDATE resources SET metadata = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(metadata), new Date().toISOString(), plugin.id);
}

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
  it("uses configured global harness targets when --harness is omitted", async () => {
    const context = await createTestContext("cli-apply-default-harness");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-default-harness.git");
      await runCli(["init", "--main", "claude-code", "--aliases", "codex"]);

      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const layer = layerModel.createLayer({ name: "default-harness-layer" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "project-context",
          content: "# Default harness apply\n",
        }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      const applyResult = await runCli([
        "project",
        "apply",
        "default-harness-layer",
        "--project",
        context.projectDir,
      ]);

      expect(applyResult.exitCode ?? 0).toBe(0);
      expect(applyResult.stdout).toContain("claude-code");
      expect(applyResult.stdout).toContain("codex");
      expect(existsSync(`${context.projectDir}/CLAUDE.md`)).toBe(true);
      expect(existsSync(`${context.projectDir}/AGENTS.md`)).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

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
          namespace: "applied",
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
        "--harness",
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
        "--harness",
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

  it("writes Claude plugin settings for plugin-only layers", async () => {
    const context = await createTestContext("cli-apply-plugin-only");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-plugin-only.git");
      await runCli(["init"]);

      const layerModel = await import("../../src/models/layer.ts");
      const pluginPins = await import("../../src/models/plugin-pins.ts");

      const layer = layerModel.createLayer({ name: "foundation-only" });
      pluginPins.addPluginToLayer(layer.id, "superpowers@obra", "5.1.0");
      pluginPins.addPluginToLayer(layer.id, "context7@anthropics", "1.0.0");

      const applyResult = await runCli([
        "project",
        "apply",
        "foundation-only",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
        "--ignore-plugin-versions",
      ]);

      expect(applyResult.exitCode ?? 0).toBe(0);
      expect(applyResult.stdout).toContain("wrote 1 file");
      expect(applyResult.stdout).toContain(".claude/settings.json");
      const settingsPath = join(context.projectDir, ".claude/settings.json");
      expect(existsSync(settingsPath)).toBe(true);
      const settings = JSON.parse(
        await Bun.file(settingsPath).text(),
      ) as { enabledPlugins: Record<string, boolean> };
      expect(settings.enabledPlugins["superpowers@claude-plugins-official"]).toBe(true);
      expect(settings.enabledPlugins["context7@claude-plugins-official"]).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("resolves exact plugin pins from layer constraints when plugins are not installed locally", async () => {
    const context = await createTestContext("cli-apply-plugins-exact-pin");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-exact-pin.git");
      await runCli(["init"]);

      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginPins = await import("../../src/models/plugin-pins.ts");

      const layer = layerModel.createLayer({ name: "catalog-like" });
      pluginPins.addPluginToLayer(layer.id, "superpowers@obra", "5.1.0");
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
        "catalog-like",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
        "--ignore-plugin-versions",
      ]);

      expect(applyResult.stderr).not.toContain("has no resolved version");
      expect(applyResult.exitCode ?? 0).toBe(0);
    } finally {
      await context.cleanup();
    }
  });

  it("materializes synced plugin skills to alias harness outputs", async () => {
    const context = await createTestContext("cli-apply-plugin-materialize");
    const fixtureHome = join(import.meta.dirname, "../fixtures/claude-plugins-home");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-plugin-materialize.git");
      await runCli(["init", "--main", "claude-code", "--aliases", "cursor"]);

      const layerModel = await import("../../src/models/layer.ts");
      const pluginPins = await import("../../src/models/plugin-pins.ts");
      const { cpSync } = await import("node:fs");

      cpSync(join(fixtureHome, ".claude"), join(context.homeDir, ".claude"), {
        recursive: true,
      });

      const layer = layerModel.createLayer({ name: "plugin-skills" });
      pluginPins.addPluginToLayer(layer.id, "formatter@acme-marketplace", "1.2.3");

      const applyResult = await runCli([
        "project",
        "apply",
        "plugin-skills",
        "--project",
        context.projectDir,
      ]);

      expect(applyResult.exitCode ?? 0).toBe(0);
      expect(applyResult.stdout).toContain("cursor");
      expect(
        existsSync(join(context.projectDir, ".cursor", "rules", "format-code.mdc")),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("auto-syncs plugins missing resolved_version before apply", async () => {
    const context = await createTestContext("cli-apply-plugins-auto-sync");

    try {
      mkdirSync(
        join(context.homeDir, ".claude/plugins/cache/acme-marketplace/formatter/.claude-plugin"),
        { recursive: true },
      );
      mkdirSync(join(context.homeDir, ".claude/plugins/CACHE/formatter/.claude-plugin"), {
        recursive: true,
      });
      writeFileSync(
        join(
          context.homeDir,
          ".claude/plugins/cache/acme-marketplace/formatter/.claude-plugin/plugin.json",
        ),
        JSON.stringify({
          name: "formatter",
          version: "1.9.0",
          description: "Formatter plugin test stub",
        }),
        "utf-8",
      );
      writeFileSync(
        join(context.homeDir, ".claude/plugins/CACHE/formatter/.claude-plugin/plugin.json"),
        JSON.stringify({
          name: "formatter",
          version: "1.9.0",
          description: "Formatter plugin test stub",
        }),
        "utf-8",
      );
      writeFileSync(
        join(context.homeDir, ".claude/plugins/installed_plugins.json"),
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
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-auto-sync.git");
      await runCli(["init"]);

      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginPins = await import("../../src/models/plugin-pins.ts");

      const layer = layerModel.createLayer({ name: "auto-sync-plugins" });
      pluginPins.addPluginToLayer(layer.id, "formatter@acme-marketplace", "1.9.0");
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
        "auto-sync-plugins",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);

      expect(applyResult.stderr).not.toContain("has no resolved version");
      expect(applyResult.stderr).not.toContain("Plugin pin version mismatch:");
      expect(applyResult.exitCode ?? 0).toBe(0);
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
      const pluginPins = await import("../../src/models/plugin-pins.ts");

      const layer = layerModel.createLayer({ name: "with-plugins" });
      pluginPins.addPluginToLayer(layer.id, "formatter@acme-marketplace", ">=2.1.0 <3.0.0");
      setPluginResolvedVersion("formatter@acme-marketplace", "1.9.0", ">=2.1.0 <3.0.0");
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
        "--harness",
        "claude-code",
      ]);

      expect(applyResult.stderr).toContain("Plugin pin version mismatch:");
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
      const pluginPins = await import("../../src/models/plugin-pins.ts");

      const layer = layerModel.createLayer({ name: "strict-plugins" });
      pluginPins.addPluginToLayer(layer.id, "formatter@acme-marketplace", ">=2.1.0 <3.0.0");
      setPluginResolvedVersion("formatter@acme-marketplace", "1.9.0", ">=2.1.0 <3.0.0");
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
        "--harness",
        "claude-code",
        "--strict-plugin-versions",
      ]);

      expect(applyResult.exitCode).toBe(2);
      expect(applyResult.stderr).toContain("Plugin pin version mismatch:");
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
      const pluginPins = await import("../../src/models/plugin-pins.ts");

      const layer = layerModel.createLayer({ name: "ignore-plugins" });
      pluginPins.addPluginToLayer(layer.id, "formatter@acme-marketplace", ">=2.1.0 <3.0.0");
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
        "--harness",
        "claude-code",
        "--ignore-plugin-versions",
      ]);

      expect(applyResult.stderr).not.toContain("Plugin pin version mismatch:");
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
      const pluginPins = await import("../../src/models/plugin-pins.ts");

      const layer = layerModel.createLayer({ name: "conflict-plugins" });
      pluginPins.addPluginToLayer(
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
        "--harness",
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
        "--harness",
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

      const bundlePath = join(context.projectDir, "bundle.harnessdeck.toml");
      writeLayerExportToml(
        bundlePath,
        makeSingleLayerExport({
          name: "bundle-reuse",
          resources: [
            {
              type: "instruction",
              name: "ctx",
              description: "",
              content: "# Reusable",
              metadata: {},
              namespace: "",
              origin_kind: "manual",
              origin_ref: "",
              content_hash: "",
              content_blob_ref: "",
            },
          ],
        }),
      );

      const firstApply = await runCli([
        "project",
        "apply",
        bundlePath,
        "--project",
        context.projectDir,
        "--harness",
        "codex",
      ]);
      const secondApply = await runCli([
        "project",
        "apply",
        bundlePath,
        "--project",
        context.projectDir,
        "--harness",
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
      const pluginPins = await import("../../src/models/plugin-pins.ts");

      const base = layerModel.createLayer({ name: "base-plugins" });
      pluginPins.addPluginToLayer(base.id, "formatter@acme-marketplace", ">=2.1.0 <3.0.0");
      setPluginResolvedVersion("formatter@acme-marketplace", "1.9.0", ">=2.1.0 <3.0.0");
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
        "--harness",
        "claude-code",
        "--strict-plugin-versions",
      ]);

      expect(applyResult.exitCode).toBe(2);
      expect(applyResult.stderr).toContain("Plugin pin version mismatch:");
      expect(existsSync(`${context.projectDir}/CLAUDE.md`)).toBe(false);
    } finally {
      await context.cleanup();
    }
  });
});
