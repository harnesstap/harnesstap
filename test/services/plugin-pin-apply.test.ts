import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createTestContext } from "../helpers/db.ts";
import { findPluginResourceByPin } from "../../src/services/layer-composition.ts";
import {
  expandPluginPinMaterialResources,
  preparePluginPinsForApply,
  syncPluginPinsForApply,
} from "../../src/services/plugin-pin-apply.ts";
import { createLayer, deleteLayer, getLayerByName } from "../../src/models/layer-model.ts";
import { attachPluginPinToLayer } from "../../src/services/layer-composition.ts";
import { getLayerOrigin } from "../../src/services/layer-origin.ts";
import type { RunCommand } from "../../src/plugins/run-command.ts";

const fixtureHome = join(import.meta.dirname, "../fixtures/claude-plugins-home");

describe("syncPluginPinsForApply", () => {
  it("resolves plugin versions from installed_plugins.json install paths", async () => {
    const context = await createTestContext("plugin-apply-sync-installed");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const layer = createLayer({ name: "sync-me" });
      attachPluginPinToLayer(layer.id, "formatter@acme-marketplace", "1.2.3");

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
      const upstream = getLayerByName("formatter", "1.2.3");
      expect(upstream).toBeDefined();
      expect(getLayerOrigin(upstream!.id)).toBe("upstream");
    } finally {
      await context.cleanup();
    }
  });

  it("rematerializes upstream layers when the pin is already resolved", async () => {
    const context = await createTestContext("plugin-apply-rematerialize");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const layer = createLayer({ name: "sync-me" });
      attachPluginPinToLayer(layer.id, "formatter@acme-marketplace", "1.2.3");

      await syncPluginPinsForApply({
        pins: [{ ref: "formatter@acme-marketplace", version_constraint: "1.2.3" }],
        homeRoot: fixtureHome,
        projectRoot: context.projectDir,
        scope: "project",
      });
      const first = getLayerByName("formatter", "1.2.3");
      expect(first).toBeDefined();
      deleteLayer(first!.id);
      expect(getLayerByName("formatter", "1.2.3")).toBeUndefined();

      await syncPluginPinsForApply({
        pins: [{ ref: "formatter@acme-marketplace", version_constraint: "1.2.3" }],
        homeRoot: fixtureHome,
        projectRoot: context.projectDir,
        scope: "project",
      });
      const rematerialized = getLayerByName("formatter", "1.2.3");
      expect(rematerialized).toBeDefined();
      expect(getLayerOrigin(rematerialized!.id)).toBe("upstream");
    } finally {
      await context.cleanup();
    }
  });

  it("records unresolved pins when install trees are missing", async () => {
    const context = await createTestContext("plugin-apply-sync-missing");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const layer = createLayer({ name: "catalog-layer" });
      attachPluginPinToLayer(layer.id, "superpowers@obra", "5.1.0");

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
      const layer = createLayer({ name: "catalog-layer" });
      attachPluginPinToLayer(layer.id, "superpowers@obra", "5.1.0");

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
      const layer = createLayer({ name: "with-plugin-skills" });
      attachPluginPinToLayer(layer.id, "formatter@acme-marketplace", "1.2.3");

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

  it("preserves existing layer resources when no plugin children are linked", () => {
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
  it("chains sync, material expansion, and validation", async () => {
    const context = await createTestContext("plugin-pin-apply-prepare");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const layer = createLayer({ name: "prepare-layer" });
      attachPluginPinToLayer(layer.id, "formatter@acme-marketplace", "1.2.3");

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
      expect(
        result.applyResources.some(
          (resource) => resource.type === "skill" && resource.name === "format-code",
        ),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
