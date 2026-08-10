import { describe, expect, it } from "bun:test";
import type { CommanderError } from "commander";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";
import { makeApEnvelope } from "../helpers/ap-package-fixtures.ts";

const FOUNDATION_CATALOG_BUNDLE = makeApEnvelope({
  name: "engineering-foundation",
  description: "Shared engineering baseline",
});

describe("CLI platforms, status, and catalog baselines", () => {
  it("lists harnesses and applies catalog baseline plugins", async () => {
    const context = await createTestContext("cli-builtins");
    const restoreFetch = createCatalogFetchMock({
      bundle: FOUNDATION_CATALOG_BUNDLE,
      plugins: [{
        orgSlug: "harnesstap-cloud",
        slug: "engineering-foundation",
        name: "Engineering foundation",
        summary: "Shared baseline",
        latestVersion: "1.0.0",
        updatedAt: new Date().toISOString(),
        tags: ["foundation"],
        visibility: "public",
      }],
    });

    try {
      await runCli(["init"]);

      const platforms = await runCli(["harness", "list"]);
      const applied = await runCli([
        "apply",
        "engineering-foundation",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
        "--dry-run",
      ]);
      const templates = await runCli(["plugin", "list"]);

      expect(platforms.stdout).toContain("claude-code");
      expect(platforms.stdout).toContain("cursor");
      expect(templates.stdout).toContain("engineering-foundation");
      expect(applied.stdout).toContain("Fetched harnesstap-cloud/engineering-foundation@1.0.0 from catalog");
      expect(applied.stdout).toContain("[dry run]");
    } finally {
      restoreFetch();
      await context.cleanup();
    }
  });

  it("rejects unknown platform subcommands", async () => {
    await expect(runCli(["platform", "list"], { commandName: "ht" })).rejects.toMatchObject({
      code: "commander.unknownCommand",
      exitCode: 1,
      message: expect.stringMatching(/unknown command/i),
    } satisfies Partial<CommanderError>);
  });

  it("reports project status for tracked plugins and snapshots", async () => {
    const context = await createTestContext("cli-status");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-status.git");
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "tracked" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "tracked-context",
          content: "# Tracked instructions",
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      await runCli([
        "apply",
        "tracked",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);

      const status = await runCli(["status", context.projectDir]);
      expect(status.stdout).toContain("Platforms");
      expect(status.stdout).toContain("APPLIED PLUGINS");
      expect(status.stdout).toContain("tracked@");
      expect(status.stdout).toContain("RESOLVED");
    } finally {
      await context.cleanup();
    }
  });
});
