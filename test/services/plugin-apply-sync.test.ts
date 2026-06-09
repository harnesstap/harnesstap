import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createTestContext } from "../helpers/db.ts";
import { findPluginResourceByPin } from "../../src/services/composition-resource.ts";
import { syncPluginPinsForApply } from "../../src/services/plugin-apply-sync.ts";
import { createLayer } from "../../src/models/layer.ts";
import { addPluginToLayer } from "../../src/models/plugin-pins.ts";
import type { RunCommand } from "../../src/plugins/run-command.ts";

const fixtureHome = join(import.meta.dirname, "../fixtures/claude-plugins-home");

describe("syncPluginPinsForApply", () => {
  it("resolves plugin versions from installed_plugins.json install paths", async () => {
    const context = await createTestContext("plugin-apply-sync-installed");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const layer = createLayer({ name: "sync-me" });
      addPluginToLayer(layer.id, "formatter@acme-marketplace", "1.2.3");

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
    } finally {
      await context.cleanup();
    }
  });

  it("records unresolved pins when install trees are missing", async () => {
    const context = await createTestContext("plugin-apply-sync-missing");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const layer = createLayer({ name: "catalog-layer" });
      addPluginToLayer(layer.id, "superpowers@obra", "5.1.0");

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
      addPluginToLayer(layer.id, "superpowers@obra", "5.1.0");

      const result = await syncPluginPinsForApply({
        pins: [{ ref: "superpowers@obra", version_constraint: "5.1.0" }],
        homeRoot: context.homeDir,
        projectRoot: context.projectDir,
        ignoreMissingInstall: true,
      });

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
