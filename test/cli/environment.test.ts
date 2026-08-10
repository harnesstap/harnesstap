import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

describe("CLI environment", () => {
  it("supports create/list/show/delete plus edit scripting mutations", async () => {
    const context = await createTestContext("cli-environment-crud");
    try {
      await runCli(["init"]);

      const created = await runCli(["environment", "create", "staging", "--format", "json"]);
      expect(JSON.parse(created.stdout)).toEqual(
        expect.objectContaining({
          name: "staging",
        }),
      );

      const listed = await runCli(["environment", "list", "--format", "json"]);
      expect(JSON.parse(listed.stdout)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            environment: expect.objectContaining({ name: "staging" }),
          }),
        ]),
      );

      const afterSet = await runCli([
        "environment",
        "edit",
        "staging",
        "--var",
        "PD_REGION=eu",
        "--format",
        "json",
      ]);
      expect(JSON.parse(afterSet.stdout)).toEqual(
        expect.objectContaining({
          values: expect.objectContaining({
            env_vars: expect.objectContaining({ PD_REGION: "eu" }),
          }),
        }),
      );

      const afterSecretSet = await runCli([
        "environment",
        "edit",
        "staging",
        "--secret",
        "PD_TOKEN:env:PD_TOKEN",
        "--format",
        "json",
      ]);
      expect(JSON.parse(afterSecretSet.stdout)).toEqual(
        expect.objectContaining({
          secret_refs: expect.objectContaining({
            PD_TOKEN: { provider: "env", ref: "PD_TOKEN" },
          }),
        }),
      );

      const shown = await runCli(["environment", "show", "staging", "--format", "json"]);
      expect(JSON.parse(shown.stdout)).toEqual(
        expect.objectContaining({
          environment: expect.objectContaining({ name: "staging" }),
          values: expect.objectContaining({
            env_vars: expect.objectContaining({ PD_REGION: "eu" }),
          }),
          secret_refs: expect.objectContaining({
            PD_TOKEN: { provider: "env", ref: "PD_TOKEN" },
          }),
        }),
      );

      const afterUnset = await runCli([
        "environment",
        "edit",
        "staging",
        "--unset-var",
        "PD_REGION",
        "--format",
        "json",
      ]);
      expect(JSON.parse(afterUnset.stdout)).toEqual(
        expect.objectContaining({
          values: expect.objectContaining({
            env_vars: {},
          }),
        }),
      );

      const afterSecretUnset = await runCli([
        "environment",
        "edit",
        "staging",
        "--unset-secret",
        "PD_TOKEN",
        "--format",
        "json",
      ]);
      expect(JSON.parse(afterSecretUnset.stdout)).toEqual(
        expect.objectContaining({
          secret_refs: {},
        }),
      );

      const deleted = await runCli(["environment", "delete", "staging", "--format", "json"]);
      expect(JSON.parse(deleted.stdout)).toEqual(
        expect.objectContaining({
          deleted: true,
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("supports plugin edit --environment/--clear-environment and shows default environment", async () => {
    const context = await createTestContext("cli-plugin-environment");
    try {
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const configuredPluginModel = await import("../../src/models/plugin-model.ts");
      const plugin = pluginModel.createPlugin({ name: "app-plugin" });
      const configuredPlugin = configuredPluginModel.createPluginFromSources({
        name: plugin.name,
        version: plugin.version,
        sourcePluginIds: [plugin.id],
      });

      await runCli(["environment", "create", "staging"]);
      await runCli(["plugin", "edit", configuredPlugin.id, "--environment", "staging"]);

      const pluginShowHuman = await runCli(["plugin", "show", "app-plugin"]);
      expect(pluginShowHuman.stdout).toContain("Default environment");
      expect(pluginShowHuman.stdout).toContain("staging");

      const pluginShowJson = await runCli(["plugin", "show", "app-plugin", "--format", "json"]);
      expect(JSON.parse(pluginShowJson.stdout)).toEqual(
        expect.objectContaining({
          configured_plugin: expect.objectContaining({
            default_environment: "staging",
          }),
        }),
      );

      await runCli(["plugin", "edit", configuredPlugin.id, "--clear-environment"]);
      const afterUnset = await runCli(["plugin", "show", "app-plugin", "--format", "json"]);
      expect(JSON.parse(afterUnset.stdout)).toEqual(
        expect.objectContaining({
          configured_plugin: expect.objectContaining({
            default_environment: null,
          }),
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("supports from-project dry-run and refresh strict failure", async () => {
    const context = await createTestContext("cli-environment-capture");
    try {
      await runCli(["init"]);
      await runCli(["harness", "set", "--main", "claude-code"]);
      await runCli(["environment", "create", "captured"]);

      mkdirSync(join(context.projectDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.projectDir, ".claude", "settings.json"),
        JSON.stringify({ env: { CAPTURE_KEY: "scan-value" } }),
        "utf-8",
      );

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const configuredPluginModel = await import("../../src/models/plugin-model.ts");
      const plugin = pluginModel.createPlugin({
        name: "capture-plugin-plugin",
        needs: ["CAPTURE_KEY", "MISSING_KEY"],
      });
      const configuredPlugin = configuredPluginModel.createPluginFromSources({
        name: "capture-plugin",
        sourcePluginIds: [plugin.id],
      });

      const createResult = await runCli([
        "environment",
        "create",
        "captured",
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

      const refreshStrict = await runCli([
        "environment",
        "create",
        "captured",
        "--from-project",
        context.projectDir,
        "--plugins",
        configuredPlugin.id,
        "--refresh",
        "--strict",
        "--format",
        "json",
      ]);
      expect(refreshStrict.exitCode).toBe(1);
      expect(JSON.parse(refreshStrict.stdout)).toEqual(
        expect.objectContaining({
          strict_failed: true,
          persisted: false,
          missing_keys: expect.arrayContaining([
            expect.objectContaining({ key: "MISSING_KEY", mode: "strict" }),
          ]),
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("supports use/status and surfaces environment cascade in project status", async () => {
    const context = await createTestContext("cli-environment-cascade");
    const previousRegion = process.env.PD_REGION;
    process.env.PD_REGION = "global";

    try {
      await runCli(["init"]);

      const projectModel = await import("../../src/models/project.ts");
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const configuredPluginModel = await import("../../src/models/plugin-model.ts");

      const project = projectModel.createProject({
        git_origin: "git@github.com:acme/cascade.git",
        name: "acme/cascade",
        local_path: context.projectDir,
      });
      const plugin = pluginModel.createPlugin({ name: "cascade-plugin" });
      const configuredPlugin = configuredPluginModel.createPluginFromSources({
        name: plugin.name,
        version: plugin.version,
        sourcePluginIds: [plugin.id],
      });
      projectModel.applyConfiguredPluginToProject({
        project_id: project.id,
        configured_plugin_id: configuredPlugin.id,
        platforms: ["claude-code"],
      });

      await runCli(["environment", "create", "default-env"]);
      await runCli(["environment", "edit", "default-env", "--var", "PD_REGION=plugin"]);
      await runCli(["plugin", "edit", configuredPlugin.id, "--environment", "default-env"]);

      const useResult = await runCli([
        "environment",
        "use",
        "default-env",
        "--format",
        "json",
      ]);
      expect(JSON.parse(useResult.stdout)).toEqual(
        expect.objectContaining({
          environment_name: "default-env",
          scope: "global",
        }),
      );

      process.env.PD_REGION = "plugin";

      const status = await runCli([
        "environment",
        "status",
        "--plugins",
        configuredPlugin.id,
        "--format",
        "json",
      ]);
      expect(JSON.parse(status.stdout)).toEqual(
        expect.objectContaining({
          effective_environment: "default-env",
          has_drift: false,
          resolved: expect.objectContaining({
            vars: expect.objectContaining({ PD_REGION: "plugin" }),
          }),
        }),
      );

      process.env.PD_REGION = "wrong";

      const driftStatus = await runCli([
        "environment",
        "status",
        "--plugins",
        configuredPlugin.id,
        "--check",
        "--format",
        "json",
      ]);
      expect(driftStatus.exitCode).toBe(1);
      expect(JSON.parse(driftStatus.stdout)).toEqual(
        expect.objectContaining({
          has_drift: true,
          drift: expect.arrayContaining([
            expect.objectContaining({
              key: "PD_REGION",
              kind: "mismatch",
            }),
          ]),
        }),
      );

      const projectStatus = await runCli([
        "status",
        context.projectDir,
        "--format",
        "json",
      ]);
      expect(JSON.parse(projectStatus.stdout)).toEqual(
        expect.objectContaining({
          environment_cascade: expect.objectContaining({
            resolved: expect.objectContaining({
              vars: expect.objectContaining({ PD_REGION: "plugin" }),
            }),
          }),
        }),
      );
    } finally {
      if (previousRegion === undefined) {
        delete process.env.PD_REGION;
      } else {
        process.env.PD_REGION = previousRegion;
      }
      await context.cleanup();
    }
  });

  it("supports local use without overriding the global active environment", async () => {
    const context = await createTestContext("cli-environment-use-local");
    try {
      await runCli(["init"]);
      await runCli(["environment", "create", "global-env"]);
      await runCli(["environment", "create", "local-env"]);

      await runCli(["environment", "use", "global-env"]);
      await runCli(["environment", "use", "local-env", "--local", "--format", "json"]);

      const status = await runCli(["environment", "status", "--format", "json"]);
      const parsed = JSON.parse(status.stdout) as {
        global_environment: string | null;
        local_environment: string | null;
        effective_environment: string | null;
      };
      expect(parsed.global_environment).toBe("global-env");
      expect(parsed.local_environment).toBe("local-env");
      expect(parsed.effective_environment).toBe("local-env");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects standalone environment export via migrate", async () => {
    const context = await createTestContext("cli-environment-export-import");
    try {
      await runCli(["init"]);
      await runCli(["environment", "create", "portable"]);
      await runCli(["environment", "edit", "portable", "--var", "PD_REGION=eu"]);

      const filePath = join(context.projectDir, "portable.ap.json");
      const exported = await runCli([
        "migrate",
        "export",
        filePath,
        "--environment",
        "portable",
        "--format",
        "json",
      ]);
      expect(exported.exitCode).toBe(1);
      expect(exported.stderr).toMatch(/--workspace/i);
    } finally {
      await context.cleanup();
    }
  });
});
