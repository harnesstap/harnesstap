import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestContext } from "../helpers/db.ts";
import { findPluginResourceByPin } from "../../src/services/plugin-composition.ts";
import {
  expandPluginPinMaterialResources,
  preparePluginPinsForApply,
  syncPluginPinsForApply,
} from "../../src/services/plugin-pin-apply.ts";
import { createPlugin, deletePlugin, getPluginByName } from "../../src/models/plugin-model.ts";
import { attachPluginPinToPlugin } from "../../src/services/plugin-composition.ts";
import { getPluginOrigin } from "../../src/services/plugin-origin.ts";
import type { RunCommand } from "../../src/plugins/run-command.ts";

const fixtureHome = join(import.meta.dirname, "../fixtures/claude-plugins-home");

describe("syncPluginPinsForApply", () => {
  it("resolves plugin versions from installed_plugins.json install paths", async () => {
    const context = await createTestContext("plugin-apply-sync-installed");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const plugin = createPlugin({ name: "sync-me" });
      attachPluginPinToPlugin(plugin.id, "formatter@acme-marketplace", "1.2.3");

      const result = await syncPluginPinsForApply({
        pins: [{ ref: "formatter@acme-marketplace", version_constraint: "1.2.3" }],
        homeRoot: fixtureHome,
        projectRoot: context.projectDir,
        scope: "project",
      });

      const synced = findPluginResourceByPin("formatter@acme-marketplace", "1.2.3");
      expect((synced?.metadata as { resolved_version?: string }).resolved_version).toBe(
        "1.2.3",
      );
      expect(result.installs[0]?.status).toBe("already_installed");
      expect(result.unresolvedPins).toEqual([]);
      const upstream = getPluginByName("formatter", "1.2.3");
      expect(upstream).toBeDefined();
      expect(getPluginOrigin(upstream!.id)).toBe("upstream");
    } finally {
      await context.cleanup();
    }
  });

  it("resolves a git SHA install when plugin.json has no version", async () => {
    const context = await createTestContext("plugin-apply-sync-sha");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const sha = "4a4211102f36";
      const installPath = join(
        context.homeDir,
        ".claude/plugins/cache/teads-plugins/design-doc",
        sha,
      );
      mkdirSync(join(installPath, ".claude-plugin"), { recursive: true });
      mkdirSync(join(installPath, "skills/design-doc"), { recursive: true });
      writeFileSync(
        join(installPath, ".claude-plugin/plugin.json"),
        JSON.stringify({ name: "design-doc", description: "Scaffold design documents" }),
      );
      writeFileSync(
        join(installPath, "skills/design-doc/SKILL.md"),
        "---\nname: design-doc\ndescription: Write design docs\n---\n\n# Design doc\n",
      );
      mkdirSync(join(context.homeDir, ".claude/plugins"), { recursive: true });
      writeFileSync(
        join(context.homeDir, ".claude/plugins/installed_plugins.json"),
        JSON.stringify({
          version: 2,
          plugins: {
            "design-doc@teads-plugins": [
              {
                scope: "user",
                installPath,
                version: sha,
                gitCommitSha: "4a4211102f3625cad9c344aa5fabe2b6f2a9a42d",
              },
            ],
          },
        }),
      );

      const plugin = createPlugin({ name: "Teads (Default)", version: "1.0.1" });
      attachPluginPinToPlugin(plugin.id, "design-doc@teads-plugins", "*");

      const result = await syncPluginPinsForApply({
        pins: [{ ref: "design-doc@teads-plugins", version_constraint: "*" }],
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
        scope: "user",
      });

      const synced = findPluginResourceByPin("design-doc@teads-plugins");
      expect((synced?.metadata as { resolved_version?: string }).resolved_version).toBe(
        sha,
      );
      expect(result.unresolvedPins).toEqual([]);
      const upstream = getPluginByName("design-doc", sha);
      expect(upstream).toBeDefined();
      expect(getPluginOrigin(upstream!.id)).toBe("upstream");
    } finally {
      await context.cleanup();
    }
  });

  it("rematerializes upstream plugins when the pin is already resolved", async () => {
    const context = await createTestContext("plugin-apply-rematerialize");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const plugin = createPlugin({ name: "sync-me" });
      attachPluginPinToPlugin(plugin.id, "formatter@acme-marketplace", "1.2.3");

      await syncPluginPinsForApply({
        pins: [{ ref: "formatter@acme-marketplace", version_constraint: "1.2.3" }],
        homeRoot: fixtureHome,
        projectRoot: context.projectDir,
        scope: "project",
      });
      const first = getPluginByName("formatter", "1.2.3");
      expect(first).toBeDefined();
      deletePlugin(first!.id);
      expect(getPluginByName("formatter", "1.2.3")).toBeUndefined();

      await syncPluginPinsForApply({
        pins: [{ ref: "formatter@acme-marketplace", version_constraint: "1.2.3" }],
        homeRoot: fixtureHome,
        projectRoot: context.projectDir,
        scope: "project",
      });
      const rematerialized = getPluginByName("formatter", "1.2.3");
      expect(rematerialized).toBeDefined();
      expect(getPluginOrigin(rematerialized!.id)).toBe("upstream");
    } finally {
      await context.cleanup();
    }
  });

  it("records unresolved pins when install trees are missing", async () => {
    const context = await createTestContext("plugin-apply-sync-missing");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const plugin = createPlugin({ name: "catalog-plugin" });
      attachPluginPinToPlugin(plugin.id, "superpowers@obra", "5.1.0");

      const failingRun: RunCommand = () => ({
        stdout: "",
        stderr: "claude not found",
        exitCode: 1,
      });
      const { ClaudeCodePluginProvider } = await import(
        "../../src/plugins/providers/claude-code.ts"
      );
      const { getPluginProvider } = await import("../../src/plugins/registry.ts");
      const provider = getPluginProvider("claude-code");
      const originalInstall = provider?.install.bind(provider);
      if (!provider || !originalInstall) {
        throw new Error("Expected claude-code plugin provider");
      }
      provider.install = async (ctx, opts) =>
        new ClaudeCodePluginProvider({
          runCommand: failingRun,
          claudeBinary: "claude",
        }).install(ctx, opts);

      const result = await syncPluginPinsForApply({
        pins: [{ ref: "superpowers@obra", version_constraint: "5.1.0" }],
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
      });

      provider.install = originalInstall;

      expect(result.installs[0]?.status).toBe("failed");
      expect(result.unresolvedPins).toContain("superpowers@obra");
    } finally {
      await context.cleanup();
    }
  });

  it("stamps exact version constraints only when ignoreMissingInstall is set", async () => {
    const context = await createTestContext("plugin-apply-sync-exact");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const plugin = createPlugin({ name: "catalog-plugin" });
      attachPluginPinToPlugin(plugin.id, "superpowers@obra", "5.1.0");

      const failingRun: RunCommand = () => ({
        stdout: "",
        stderr: "claude not found",
        exitCode: 1,
      });
      const { ClaudeCodePluginProvider } = await import(
        "../../src/plugins/providers/claude-code.ts"
      );
      const { getPluginProvider } = await import("../../src/plugins/registry.ts");
      const provider = getPluginProvider("claude-code");
      const originalInstall = provider?.install.bind(provider);
      if (!provider || !originalInstall) {
        throw new Error("Expected claude-code plugin provider");
      }
      provider.install = async (ctx, opts) =>
        new ClaudeCodePluginProvider({
          runCommand: failingRun,
          claudeBinary: "claude",
        }).install(ctx, opts);

      const result = await syncPluginPinsForApply({
        pins: [{ ref: "superpowers@obra", version_constraint: "5.1.0" }],
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
        ignoreMissingInstall: true,
      });

      provider.install = originalInstall;

      const synced = findPluginResourceByPin("superpowers@obra", "5.1.0");
      expect((synced?.metadata as { resolved_version?: string }).resolved_version).toBe(
        "5.1.0",
      );
      expect(result.unresolvedPins).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });
});

describe("expandPluginPinMaterialResources", () => {
  it("includes marketplace-linked skills from synced plugin install trees", async () => {
    const context = await createTestContext("plugin-materialize-expand");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const hostPlugin = createPlugin({ name: "with-plugin-skills" });
      attachPluginPinToPlugin(hostPlugin.id, "formatter@acme-marketplace", "1.2.3");

      await syncPluginPinsForApply({
        pins: [{ ref: "formatter@acme-marketplace", version_constraint: "1.2.3" }],
        homeRoot: fixtureHome,
        projectRoot: context.projectDir,
        scope: "project",
      });

      const plugin = findPluginResourceByPin("formatter@acme-marketplace", "1.2.3");
      expect(plugin).toBeDefined();

      const expanded = expandPluginPinMaterialResources([
        { ref: "formatter@acme-marketplace", version_constraint: "1.2.3" },
      ]);

      expect(expanded.some((resource) => resource.type === "skill" && resource.name === "format-code")).toBe(
        true,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("preserves existing plugin resources when no plugin children are linked", () => {
    const base = {
      id: "01TEST",
      type: "instruction" as const,
      name: "project-context",
      description: "",
      content: "# Base",
      metadata: {},
      source: "test",
      namespace: "",
      origin_kind: "local_snapshot" as const,
      origin_ref: "",
      content_hash: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const expanded = expandPluginPinMaterialResources([], [base]);
    expect(expanded).toEqual([base]);
  });
});

describe("preparePluginPinsForApply", () => {
  it("chains sync, upstream materialization, and validation without splicing resources", async () => {
    const context = await createTestContext("plugin-pin-apply-prepare");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const plugin = createPlugin({ name: "prepare-plugin" });
      attachPluginPinToPlugin(plugin.id, "formatter@acme-marketplace", "1.2.3");

      const result = await preparePluginPinsForApply({
        pins: [{ ref: "formatter@acme-marketplace", version_constraint: "1.2.3" }],
        baseResources: [],
        homeRoot: fixtureHome,
        projectRoot: context.projectDir,
        scope: "project",
      });

      expect(result.installs[0]?.status).toBe("already_installed");
      expect(result.unresolvedPins).toEqual([]);
      expect(result.validationIssues).toEqual([]);
      expect(result.applyResources).toEqual([]);
      expect(result.extraMaterialized).toBe(0);
      expect(getPluginByName("formatter", "1.2.3")).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });
});
