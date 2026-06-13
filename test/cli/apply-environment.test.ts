import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { createEnvironment, addResourceToEnvironment } from "../../src/models/environment.ts";
import { createPlugin, addResourceToPlugin } from "../../src/models/plugin-component.ts";
import { createResource } from "../../src/models/resource.ts";
import { createConfiguredLayer } from "../../src/models/configured-layer.ts";
import { createDeck, setDeckActiveEnvironment } from "../../src/models/deck.ts";

describe("CLI apply with environment cascade", () => {
  it("materializes deck active environment over layer default", async () => {
    const context = await createTestContext("cli-apply-environment");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-env.git");
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

      createConfiguredLayer({
        name: "env-layer",
        pluginIds: [plugin.id],
        environmentId: prod.id,
      });

      const deck = createDeck({
        name: "project-deck",
        rootPath: context.projectDir,
      });
      setDeckActiveEnvironment(deck.id, staging.id);

      mkdirSync(join(context.projectDir, ".harnessdeck", "environments"), {
        recursive: true,
      });
      writeFileSync(
        join(context.projectDir, ".harnessdeck", "environments", "staging.json"),
        JSON.stringify({ values: { PD_REGION: "staging-file" } }),
        "utf-8",
      );
      writeFileSync(
        join(context.projectDir, ".harnessdeck", "environments", "prod.json"),
        JSON.stringify({ values: { PD_REGION: "prod-file" } }),
        "utf-8",
      );

      const applyResult = await runCli([
        "project",
        "apply",
        "env-layer",
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
});
