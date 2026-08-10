import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { createEnvironment, addResourceToEnvironment } from "../../src/models/environment.ts";
import { createPlugin, addResourceToPlugin } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { createPluginFromSources } from "../../src/models/plugin-model.ts";

describe("CLI apply with environment cascade", () => {
  it("materializes the global active environment when the plugin has no default", async () => {
    const context = await createTestContext("cli-apply-environment");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-env.git");
      await runCli(["init"]);

      const plugin = createPlugin({ name: "env-demo" });
      addResourceToPlugin(
        plugin.id,
        createResource({
          type: "instruction",
          name: "env-context",
          description: "",
          content: "# Env demo",
          metadata: {},
          source: "manual",
        }).id,
      );

      const staging = createEnvironment({ name: "staging" });
      addResourceToEnvironment(
        staging.id,
        createResource({
          type: "env_var",
          name: "PD_REGION",
          namespace: "staging",
          description: "",
          content: "",
          metadata: { key: "PD_REGION", value: "staging" },
          source: "manual",
        }),
      );

      createPluginFromSources({
        name: "env-plugin",
        sourcePluginIds: [plugin.id],
      });

      await runCli(["environment", "use", "staging"]);

      const applyResult = await runCli([
        "apply",
        "env-plugin",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);

      expect(applyResult.stdout).toContain("claude-code");
      expect(existsSync(join(context.projectDir, ".claude/settings.json"))).toBe(true);

      const settings = JSON.parse(
        readFileSync(join(context.projectDir, ".claude/settings.json"), "utf-8"),
      ) as { env?: Record<string, string> };

      expect(settings.env?.PD_REGION).toBe("staging");
    } finally {
      await context.cleanup();
    }
  });

  it("lets plugin default environments override the global active environment on apply", async () => {
    const context = await createTestContext("cli-apply-plugin-default-env");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-plugin-env.git");
      await runCli(["init"]);

      const plugin = createPlugin({ name: "env-demo-plugin-default" });
      addResourceToPlugin(
        plugin.id,
        createResource({
          type: "instruction",
          name: "env-context",
          description: "",
          content: "# Env demo",
          metadata: {},
          source: "manual",
        }).id,
      );

      const staging = createEnvironment({ name: "staging" });
      addResourceToEnvironment(
        staging.id,
        createResource({
          type: "env_var",
          name: "PD_REGION",
          namespace: "staging",
          description: "",
          content: "",
          metadata: { key: "PD_REGION", value: "staging" },
          source: "manual",
        }),
      );

      const prod = createEnvironment({ name: "prod" });
      addResourceToEnvironment(
        prod.id,
        createResource({
          type: "env_var",
          name: "PD_REGION",
          namespace: "prod",
          description: "",
          content: "",
          metadata: { key: "PD_REGION", value: "prod" },
          source: "manual",
        }),
      );

      createPluginFromSources({
        name: "env-plugin-default",
        sourcePluginIds: [plugin.id],
        environmentId: prod.id,
      });

      await runCli(["environment", "use", "staging"]);

      const applyResult = await runCli([
        "apply",
        "env-plugin-default",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);

      expect(applyResult.stdout).toContain("claude-code");

      const settings = JSON.parse(
        readFileSync(join(context.projectDir, ".claude/settings.json"), "utf-8"),
      ) as { env?: Record<string, string> };

      expect(settings.env?.PD_REGION).toBe("prod");
    } finally {
      await context.cleanup();
    }
  });
});
