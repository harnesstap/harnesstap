import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { makeApEnvelope } from "../helpers/ap-package-fixtures.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { findPluginResourceByPin } from "../../src/services/plugin-composition.ts";
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
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-default-harness.git");
      await runCli(["init", "--main", "claude-code", "--aliases", "codex"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "default-harness-plugin" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "project-context",
          content: "# Default harness apply\n",
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const applyResult = await runCli([
        "apply",
        "default-harness-plugin",
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
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-apply.git");
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const projectModel = await import("../../src/models/project.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const snapshotModel = await import("../../src/models/snapshot.ts");
      const plugin = pluginModel.createPlugin({ name: "applied" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "project-context",
          namespace: "applied",
          content: "# Applied instructions",
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const dryRun = await runCli([
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
        "apply",
        "applied",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);

      const project = projectModel.getProjectByOrigin(
        "git@github.com:acme/harnesstap-apply.git",
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

  it("writes Claude plugin settings for plugin-only plugins", async () => {
    const context = await createTestContext("cli-apply-plugin-only");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-plugin-only.git");
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const pluginPins = await import("../../src/services/plugin-composition.ts");

      const plugin = pluginModel.createPlugin({ name: "foundation-only" });
      pluginPins.attachPluginPinToPlugin(plugin.id, "superpowers@obra", "5.1.0");
      pluginPins.attachPluginPinToPlugin(plugin.id, "context7@anthropics", "1.0.0");

      const applyResult = await runCli([
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

  it("resolves exact plugin pins from plugin constraints when plugins are not installed locally", async () => {
    const context = await createTestContext("cli-apply-plugins-exact-pin");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-exact-pin.git");
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginPins = await import("../../src/services/plugin-composition.ts");

      const plugin = pluginModel.createPlugin({ name: "catalog-like" });
      pluginPins.attachPluginPinToPlugin(plugin.id, "superpowers@obra", "5.1.0");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "ctx",
          content: "# Ctx",
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const applyResult = await runCli([
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
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-plugin-materialize.git");
      await runCli(["init", "--main", "claude-code", "--aliases", "cursor"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const pluginPins = await import("../../src/services/plugin-composition.ts");
      const { cpSync } = await import("node:fs");

      cpSync(join(fixtureHome, ".claude"), join(context.homeDir, ".claude"), {
        recursive: true,
      });

      const plugin = pluginModel.createPlugin({ name: "plugin-skills" });
      pluginPins.attachPluginPinToPlugin(plugin.id, "formatter@acme-marketplace", "1.2.3");

      const applyResult = await runCli([
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
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-auto-sync.git");
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginPins = await import("../../src/services/plugin-composition.ts");

      const plugin = pluginModel.createPlugin({ name: "auto-sync-plugins" });
      pluginPins.attachPluginPinToPlugin(plugin.id, "formatter@acme-marketplace", "1.9.0");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "ctx",
          content: "# Ctx",
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const applyResult = await runCli([
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

  it("warns on stderr for plugin plugin constraint mismatch without failing", async () => {
    const context = await createTestContext("cli-apply-plugins-warn");

    try {
      seedClaudePluginMismatchFixture(context.homeDir, context.projectDir);
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-plugins.git");
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginPins = await import("../../src/services/plugin-composition.ts");

      const plugin = pluginModel.createPlugin({ name: "with-plugins" });
      pluginPins.attachPluginPinToPlugin(plugin.id, "formatter@acme-marketplace", ">=2.1.0 <3.0.0");
      setPluginResolvedVersion("formatter@acme-marketplace", "1.9.0", ">=2.1.0 <3.0.0");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "ctx",
          content: "# Ctx",
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const applyResult = await runCli([
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
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-strict.git");
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginPins = await import("../../src/services/plugin-composition.ts");

      const plugin = pluginModel.createPlugin({ name: "strict-plugins" });
      pluginPins.attachPluginPinToPlugin(plugin.id, "formatter@acme-marketplace", ">=2.1.0 <3.0.0");
      setPluginResolvedVersion("formatter@acme-marketplace", "1.9.0", ">=2.1.0 <3.0.0");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "ctx",
          content: "# Ctx",
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const applyResult = await runCli([
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
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-ignore.git");
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginPins = await import("../../src/services/plugin-composition.ts");

      const plugin = pluginModel.createPlugin({ name: "ignore-plugins" });
      pluginPins.attachPluginPinToPlugin(plugin.id, "formatter@acme-marketplace", ">=2.1.0 <3.0.0");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "ctx",
          content: "# Ctx",
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const applyResult = await runCli([
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
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-conflict.git");
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginPins = await import("../../src/services/plugin-composition.ts");

      const plugin = pluginModel.createPlugin({ name: "conflict-plugins" });
      pluginPins.attachPluginPinToPlugin(
        plugin.id,
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
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const applyResult = await runCli([
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

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const projectModel = await import("../../src/models/project.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "non-git-apply" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "ctx",
          content: "# Non-git",
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const applyResult = await runCli([
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

  it("reuses imported plugins when reapplying the same bundle path", async () => {
    const context = await createTestContext("cli-apply-bundle-reuse");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-bundle-reuse.git");
      await runCli(["init"]);

      const bundlePath = join(context.projectDir, "bundle.ap.json");
      writeFileSync(
        bundlePath,
        makeApEnvelope({
          name: "bundle-reuse",
          skillName: "ctx",
          skillBody: "# Reusable",
        }),
        "utf-8",
      );

      const firstApply = await runCli([
        "apply",
        bundlePath,
        "--project",
        context.projectDir,
        "--harness",
        "codex",
      ]);
      const secondApply = await runCli([
        "apply",
        bundlePath,
        "--project",
        context.projectDir,
        "--harness",
        "codex",
      ]);

      expect(firstApply.exitCode).toBeUndefined();
      expect(secondApply.exitCode).toBeUndefined();

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const plugins = pluginModel
        .listPlugins()
        .filter((plugin) => plugin.name === "bundle-reuse" && plugin.version === "1.0.0");
      expect(plugins).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });

  it("validates merged plugin pins from earlier plugins in strict mode", async () => {
    const context = await createTestContext("cli-apply-plugins-merged-strict");

    try {
      seedClaudePluginMismatchFixture(context.homeDir, context.projectDir);
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-merged-strict.git");
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const pluginPins = await import("../../src/services/plugin-composition.ts");

      const base = pluginModel.createPlugin({ name: "base-plugins" });
      pluginPins.attachPluginPinToPlugin(base.id, "formatter@acme-marketplace", ">=2.1.0 <3.0.0");
      setPluginResolvedVersion("formatter@acme-marketplace", "1.9.0", ">=2.1.0 <3.0.0");
      const baseResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "base",
          content: "# Base",
        }),
      );
      pluginModel.addResourceToPlugin(base.id, baseResource.id);

      const overlay = pluginModel.createPlugin({ name: "overlay-no-plugins" });
      const overlayResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "overlay",
          content: "# Overlay",
        }),
      );
      pluginModel.addResourceToPlugin(overlay.id, overlayResource.id);

      const applyResult = await runCli([
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
