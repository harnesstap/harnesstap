import { describe, expect, it } from "bun:test";
import type { CommanderError } from "commander";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";
import { formatLayerExportToml } from "../../src/services/transport/layer.ts";

const FOUNDATION_CATALOG_BUNDLE = formatLayerExportToml({
  $schema: "urn:harnesstap:layer:v1",
  version: 1,
  layers: [
    {
      name: "engineering-foundation",
      version: "1.0.0",
      description: "Shared engineering baseline",
      tags: ["foundation"],
      resources: [],
      plugin_pins: [{ ref: "superpowers@obra", version_constraint: "5.1.0" }],
    },
  ],
  embedded_plugins: [],
});

describe("CLI platforms, status, and catalog baselines", () => {
  it("lists harnesses and applies catalog baseline layers", async () => {
    const context = await createTestContext("cli-builtins");
    const restoreFetch = createCatalogFetchMock({
      baseUrl: "https://harnessdeck.kayrnt.fr",
      bundle: FOUNDATION_CATALOG_BUNDLE,
      layers: [{
        orgSlug: "harnessdeck-cloud",
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
        "layer", "apply",
        "engineering-foundation",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
        "--dry-run",
      ]);
      const templates = await runCli(["layer", "list"]);

      expect(platforms.stdout).toContain("claude-code");
      expect(platforms.stdout).toContain("cursor");
      expect(templates.stdout).toContain("engineering-foundation");
      expect(applied.stdout).toContain("Fetched harnessdeck-cloud/engineering-foundation@1.0.0 from catalog");
      expect(applied.stdout).toContain("[dry run]");
    } finally {
      restoreFetch();
      await context.cleanup();
    }
  });

  it("rejects unknown platform subcommands", async () => {
    await expect(runCli(["platform", "list"], { commandName: "hd" })).rejects.toMatchObject({
      code: "commander.unknownCommand",
      exitCode: 1,
      message: expect.stringMatching(/unknown command/i),
    } satisfies Partial<CommanderError>);
  });

  it("reports project status for tracked layers and snapshots", async () => {
    const context = await createTestContext("cli-status");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-status.git");
      await runCli(["init"]);

      const layerModel = await import("../../src/models/layer-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const layer = layerModel.createLayer({ name: "tracked" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "tracked-context",
          content: "# Tracked instructions",
        }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      await runCli([
        "layer", "apply",
        "tracked",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);

      const status = await runCli(["status", context.projectDir]);
      expect(status.stdout).toContain("Platforms");
      expect(status.stdout).toContain("APPLIED LAYERS");
      expect(status.stdout).toContain("tracked@");
      expect(status.stdout).toContain("RESOLVED");
    } finally {
      await context.cleanup();
    }
  });
});
