import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

const FROM_PLUGIN_ENV_KEYS = ["BIND_REGION", "BIND_TOKEN"];

describe("CLI environment revamp", () => {
  afterEach(() => {
    for (const key of FROM_PLUGIN_ENV_KEYS) {
      delete process.env[key];
    }
  });

  it("environment create --blank creates an empty environment", async () => {
    const context = await createTestContext("cli-environment-revamp-blank");
    try {
      await runCli(["init"]);

      const created = await runCli([
        "environment",
        "create",
        "blank-env",
        "--blank",
        "--format",
        "json",
      ]);
      expect(JSON.parse(created.stdout)).toEqual(
        expect.objectContaining({
          name: "blank-env",
        }),
      );

      const shown = await runCli(["environment", "show", "blank-env", "--format", "json"]);
      expect(JSON.parse(shown.stdout)).toEqual(
        expect.objectContaining({
          environment: expect.objectContaining({ name: "blank-env" }),
          values: expect.objectContaining({
            env_vars: {},
            model_configs: [],
            permissions: [],
          }),
          secret_refs: {},
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("environment create --from-project captures scoped project values", async () => {
    const context = await createTestContext("cli-environment-revamp-from-project");
    try {
      await runCli(["init"]);
      await runCli(["harness", "set", "--main", "claude-code"]);

      mkdirSync(join(context.projectDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.projectDir, ".claude", "settings.json"),
        JSON.stringify({ env: { CAPTURE_KEY: "scan-value" } }),
        "utf-8",
      );

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const plugin = pluginModel.createPlugin({
        name: "revamp-capture-plugin",
        needs: ["CAPTURE_KEY", "MISSING_KEY"],
      });
      const configuredPlugin = pluginModel.createPluginFromSources({
        name: "revamp-capture-plugin",
        sourcePluginIds: [plugin.id],
      });

      const createResult = await runCli([
        "environment",
        "create",
        "revamp-captured",
        "--from-project",
        context.projectDir,
        "--plugins",
        configuredPlugin.id,
        "--dry-run",
        "--format",
        "json",
      ]);
      expect(JSON.parse(createResult.stdout)).toEqual(
        expect.objectContaining({
          persisted: false,
          strict_failed: false,
          values: expect.objectContaining({ CAPTURE_KEY: "scan-value" }),
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("environment create --from-project --refresh requires an existing environment", async () => {
    const context = await createTestContext("cli-environment-revamp-refresh");
    try {
      await runCli(["init"]);
      await runCli(["harness", "set", "--main", "claude-code"]);

      mkdirSync(join(context.projectDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.projectDir, ".claude", "settings.json"),
        JSON.stringify({ env: { CAPTURE_KEY: "scan-value" } }),
        "utf-8",
      );

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const plugin = pluginModel.createPlugin({
        name: "revamp-refresh-plugin",
        needs: ["CAPTURE_KEY"],
      });
      const configuredPlugin = pluginModel.createPluginFromSources({
        name: "revamp-refresh-plugin",
        sourcePluginIds: [plugin.id],
      });

      const missingRefresh = await runCli([
        "environment",
        "create",
        "missing-refresh-env",
        "--from-project",
        context.projectDir,
        "--plugins",
        configuredPlugin.id,
        "--refresh",
        "--format",
        "json",
      ]);
      expect(missingRefresh.exitCode).toBe(1);
      expect(missingRefresh.stderr + missingRefresh.stdout).toContain(
        "Environment not found for refresh",
      );

      await runCli(["environment", "create", "existing-refresh-env"]);
      const refreshResult = await runCli([
        "environment",
        "create",
        "existing-refresh-env",
        "--from-project",
        context.projectDir,
        "--plugins",
        configuredPlugin.id,
        "--refresh",
        "--dry-run",
        "--format",
        "json",
      ]);
      expect(JSON.parse(refreshResult.stdout)).toEqual(
        expect.objectContaining({
          mode: "refresh",
          persisted: false,
          values: expect.objectContaining({ CAPTURE_KEY: "scan-value" }),
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("environment create --from-plugin --bind sets default_environment_id", async () => {
    const context = await createTestContext("cli-environment-revamp-from-plugin-bind");
    try {
      await runCli(["init"]);

      process.env.BIND_REGION = "eu";
      process.env.BIND_TOKEN = "secret-token";

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const plugin = pluginModel.createPlugin({
        name: "bind-plugin",
        needs: ["BIND_REGION", "BIND_TOKEN"],
      });
      const configuredPlugin = pluginModel.createPluginFromSources({
        name: "bind-plugin",
        sourcePluginIds: [plugin.id],
      });

      await runCli([
        "environment",
        "create",
        "bind-env",
        "--from-plugin",
        configuredPlugin.id,
        "--bind",
        "--format",
        "json",
      ]);

      const refreshedPlugin = pluginModel.getPluginById(configuredPlugin.id);
      expect(refreshedPlugin?.default_environment_id).toBeDefined();

      const shown = await runCli(["environment", "show", "bind-env", "--format", "json"]);
      expect(JSON.parse(shown.stdout)).toEqual(
        expect.objectContaining({
          values: expect.objectContaining({
            env_vars: {},
          }),
          secret_refs: expect.objectContaining({
            BIND_REGION: { provider: "env", ref: "BIND_REGION" },
            BIND_TOKEN: { provider: "env", ref: "BIND_TOKEN" },
          }),
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("environment show lists REFERENCES when plugin has default_environment_id", async () => {
    const context = await createTestContext("cli-environment-revamp-refs");
    try {
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const plugin = pluginModel.createPlugin({ name: "app-plugin" });
      const configuredPlugin = pluginModel.createPluginFromSources({
        name: plugin.name,
        version: plugin.version,
        sourcePluginIds: [plugin.id],
      });

      await runCli(["environment", "create", "staging"]);
      await runCli(["plugin", "edit", configuredPlugin.id, "--environment", "staging"]);

      const show = await runCli(["environment", "show", "staging"]);
      expect(show.stdout).toContain("REFERENCES");
      expect(show.stdout).toContain("app-plugin@1.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("environment show --plugin shows REQUIREMENT GAPS with missing keys", async () => {
    const context = await createTestContext("cli-environment-revamp-gaps");
    try {
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const plugin = pluginModel.createPlugin({
        name: "gap-plugin",
        needs: ["MISSING_VAR"],
      });
      const configuredPlugin = pluginModel.createPluginFromSources({
        name: "gap-plugin",
        sourcePluginIds: [plugin.id],
      });

      await runCli(["environment", "create", "gap-env"]);

      const show = await runCli([
        "environment",
        "show",
        "gap-env",
        "--plugin",
        configuredPlugin.id,
      ]);
      expect(show.stdout).toContain("REQUIREMENT GAPS");
      expect(show.stdout).toContain("MISSING_VAR");
      expect(show.stdout).toContain("missing");
      expect(show.stdout).toContain("plugin_needs");
    } finally {
      await context.cleanup();
    }
  });

  it("environment delete --force deletes an environment", async () => {
    const context = await createTestContext("cli-environment-revamp-delete-force");
    try {
      await runCli(["init"]);
      await runCli(["environment", "create", "forced-delete-env"]);

      const result = await runCli([
        "environment",
        "delete",
        "forced-delete-env",
        "--force",
        "--format",
        "json",
      ]);
      expect(result.exitCode ?? 0).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(
        expect.objectContaining({
          deleted: true,
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("environment delete rejects referenced environments without --force", async () => {
    const context = await createTestContext("cli-environment-revamp-delete-ref");
    try {
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const plugin = pluginModel.createPlugin({ name: "ref-plugin" });
      const configuredPlugin = pluginModel.createPluginFromSources({
        name: plugin.name,
        version: plugin.version,
        sourcePluginIds: [plugin.id],
      });

      await runCli(["environment", "create", "referenced-env"]);
      await runCli(["plugin", "edit", configuredPlugin.id, "--environment", "referenced-env"]);

      const result = await runCli([
        "environment",
        "delete",
        "referenced-env",
        "--format",
        "json",
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr + result.stdout).toContain("still referenced");
    } finally {
      await context.cleanup();
    }
  });

  it("environment delete prompts on TTY and deletes the selected environment", async () => {
    const context = await createTestContext("cli-environment-revamp-delete-wizard");
    try {
      await runCli(["init"]);
      const environmentModel = await import("../../src/models/environment.ts");

      await runCli(["environment", "create", "keep-env"]);
      await runCli(["environment", "create", "delete-me"]);

      const result = await runCli(["environment", "delete"], {
        isTTY: true,
        promptResponses: [
          { value: "delete-me" },
          { value: true },
        ],
      });

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("delete-me");
      expect(environmentModel.getEnvironmentByName("delete-me")).toBeUndefined();
      expect(environmentModel.getEnvironmentByName("keep-env")?.name).toBe("keep-env");
    } finally {
      await context.cleanup();
    }
  });
});
