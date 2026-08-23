import { describe, expect, it } from "bun:test";
import type { CommanderError } from "commander";
import { createPlugin } from "../../src/models/plugin-model.ts";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { importBuiltinFixtures } from "../helpers/builtin-fixtures.ts";

describe("CLI plugin", () => {
  it("creates a plugin with an explicit version via --version", async () => {
    const context = await createTestContext("cli-plugin-version");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");

      await runCli(["plugin", "create", "versioned-plugin", "--version", "2.3.0"]);

      const plugin = pluginModel.getPlugin("versioned-plugin");
      expect(plugin).toBeDefined();
      expect(plugin?.version).toBe("2.3.0");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin list shows separate name and version columns", async () => {
    const context = await createTestContext("cli-plugin-list-versions");
    try {
      await runCli(["init"]);

      await runCli(["plugin", "create", "team-stack", "--version", "1.0.0"]);
      await runCli(["plugin", "create", "team-stack", "--version", "2.0.0"]);

      const listResult = await runCli(["plugin", "list"]);
      expect(listResult.stdout).toContain("NAME");
      expect(listResult.stdout).toContain("ORIGIN");
      expect(listResult.stdout).toContain("VERSION");
      expect(listResult.stdout).toContain("DESCRIPTION");
      expect(listResult.stdout).not.toContain("team-stack@1.0.0");
      expect(listResult.stdout).not.toContain("team-stack@2.0.0");
      expect(listResult.stdout).toMatch(/team-stack\s+\|\s+authored\s+\|\s+1\.0\.0/);
      expect(listResult.stdout).toMatch(/team-stack\s+\|\s+authored\s+\|\s+2\.0\.0/);
    } finally {
      await context.cleanup();
    }
  });

  it("plugin list hides IDs by default and reveals them with --show-id", async () => {
    const context = await createTestContext("cli-plugin-list-show-id");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");

      await runCli(["plugin", "create", "team-stack", "--version", "1.0.0"]);
      const plugin = pluginModel.getPlugin("team-stack");
      if (!plugin) throw new Error("Expected plugin to exist");
      const shortId = `${plugin.id.slice(0, 6)}…${plugin.id.slice(-4)}`;

      const hidden = await runCli(["plugin", "list"]);
      const shown = await runCli(["plugin", "list", "--show-id"]);

      expect(hidden.stdout).not.toMatch(/\|\s+ID\s+\|/);
      expect(hidden.stdout).not.toContain(shortId);
      expect(shown.stdout).toMatch(/\|\s+ID\s+\|/);
      expect(shown.stdout).toContain(shortId);
    } finally {
      await context.cleanup();
    }
  });

  it("plugin show displays name@version and dependencies", async () => {
    const context = await createTestContext("cli-plugin-show-version");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");

      await runCli(["plugin", "create", "team-stack", "--version", "1.2.0"]);
      const plugin = pluginModel.getPlugin("team-stack");
      if (!plugin) throw new Error("Expected plugin to exist");

      pluginModel.addDependencyToPlugin(plugin.id, "baseline", "^1.0.0");
      pluginModel.addDependencyToPlugin(plugin.id, "extras", ">=2.0.0");

      const showResult = await runCli(["plugin", "show", "team-stack@1.2.0"]);
      expect(showResult.stdout).toContain("team-stack@1.2.0");
      expect(showResult.stdout).toContain("baseline");
      expect(showResult.stdout).toContain("^1.0.0");
      expect(showResult.stdout).toContain("extras");
      expect(showResult.stdout).toContain(">=2.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin show prompts for plugin name when omitted on TTY", async () => {
    const context = await createTestContext("cli-plugin-show-prompt");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "team-stack", "--version", "1.2.0"]);
      await runCli(["plugin", "create", "baseline", "--version", "1.0.0"]);

      const result = await runCli(["plugin", "show"], {
        isTTY: true,
        promptResponses: [{ value: "team-stack@1.2.0" }],
      });

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("team-stack@1.2.0");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin show fails without prompt when name is omitted in non-interactive mode", async () => {
    const context = await createTestContext("cli-plugin-show-no-prompt");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "team-stack"]);

      const result = await runCli(["plugin", "show"], {
        isTTY: false,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing required argument 'name'");
    } finally {
      await context.cleanup();
    }
  });


  it("plugin combine/detach --type plugin manage dependencies via CLI", async () => {
    const context = await createTestContext("cli-plugin-dependency");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");

      await runCli(["plugin", "create", "team-stack", "--version", "1.2.0"]);

      await runCli(["plugin", "edit", "team-stack@1.2.0", "--add", "baseline", "--type", "plugin", "--version", "^1.0.0", "--no-interactive"]);

      const plugin = pluginModel.getPlugin("team-stack@1.2.0");
      if (!plugin) throw new Error("Expected plugin to exist");

      const deps = pluginModel.listPluginDependencies(plugin.id);
      expect(deps).toHaveLength(1);
      expect(deps[0].dependency_name).toBe("baseline");
      expect(deps[0].version_constraint).toBe("^1.0.0");

      await runCli(["plugin", "edit", "team-stack@1.2.0", "--remove", "baseline", "--type", "plugin", "--no-interactive"]);

      const afterRemove = pluginModel.listPluginDependencies(plugin.id);
      expect(afterRemove).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("plugin combine --type plugin reports error for invalid plugin selector instead of crashing", async () => {
    const context = await createTestContext("cli-plugin-dep-invalid-selector");
    try {
      await runCli(["init"]);

      const result = await runCli(["plugin", "edit", "team-stack@not-semver", "--add", "baseline", "--type", "plugin", "--version", "^1.0.0", "--no-interactive"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/invalid version constraint/i);
      expect(result.stderr).not.toMatch(/plugin not found/i);
      expect(result.stdout).not.toContain("Added dependency");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin combine --type plugin sets a failing exit code when the plugin is missing", async () => {
    const context = await createTestContext("cli-plugin-dep-missing-plugin");
    try {
      await runCli(["init"]);

      const result = await runCli(["plugin", "edit", "missing-plugin", "--add", "baseline", "--type", "plugin", "--version", "^1.0.0", "--no-interactive"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/plugin not found: missing-plugin/i);
      expect(result.stdout).not.toContain("Added dependency");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin combine --type plugin sets a failing exit code for an invalid version constraint", async () => {
    const context = await createTestContext("cli-plugin-dep-invalid-version");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "team-stack", "--version", "1.2.0"]);

      const result = await runCli(["plugin", "edit", "team-stack@1.2.0", "--add", "baseline", "--type", "plugin", "--version", "not-semver", "--no-interactive"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/invalid version constraint/i);
    } finally {
      await context.cleanup();
    }
  });

  it("plugin uncombine --type plugin sets a failing exit code when the plugin is missing", async () => {
    const context = await createTestContext("cli-plugin-remove-dep-missing-plugin");
    try {
      await runCli(["init"]);

      const result = await runCli(["plugin", "edit", "missing-plugin", "--remove", "baseline", "--type", "plugin", "--no-interactive"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/plugin not found: missing-plugin/i);
    } finally {
      await context.cleanup();
    }
  });

  it("plugin uncombine --type plugin sets a failing exit code when the dependency is missing", async () => {
    const context = await createTestContext("cli-plugin-remove-dep-missing-dependency");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "team-stack", "--version", "1.2.0"]);

      const result = await runCli(["plugin", "edit", "team-stack@1.2.0", "--remove", "baseline", "--type", "plugin", "--no-interactive"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/dependency "baseline" not found/i);
    } finally {
      await context.cleanup();
    }
  });

  it("plugin delete reports invalid selectors and exits with failure", async () => {
    const context = await createTestContext("cli-plugin-delete-invalid-selector");
    try {
      await runCli(["init"]);

      const result = await runCli(["plugin", "delete", "tool@not-semver"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/invalid version constraint/i);
      expect(result.stderr).not.toMatch(/plugin not found/i);
    } finally {
      await context.cleanup();
    }
  });

  it("plugin delete sets a failing exit code when the plugin is missing", async () => {
    const context = await createTestContext("cli-plugin-delete-missing");
    try {
      await runCli(["init"]);

      const result = await runCli(["plugin", "delete", "missing-plugin"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/plugin not found: missing-plugin/i);
    } finally {
      await context.cleanup();
    }
  });

  it("plugin delete accepts a versioned selector and deletes only that version", async () => {
    const context = await createTestContext("cli-plugin-delete-version-selector");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");

      await runCli(["plugin", "create", "tool", "--version", "1.0.0"]);
      await runCli(["plugin", "create", "tool", "--version", "2.0.0"]);

      const result = await runCli(["plugin", "delete", "tool@1.0.0"]);

      expect(result.exitCode ?? 0).toBe(0);
      expect(pluginModel.getPlugin("tool@1.0.0")).toBeUndefined();
      expect(pluginModel.getPlugin("tool@2.0.0")?.version).toBe("2.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin delete by plain name reports the deleted latest version", async () => {
    const context = await createTestContext("cli-plugin-delete-latest-version");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");

      await runCli(["plugin", "create", "tool", "--version", "1.0.0"]);
      await runCli(["plugin", "create", "tool", "--version", "2.0.0"]);

      const result = await runCli(["plugin", "delete", "tool"]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain("tool@2.0.0");
      expect(pluginModel.getPlugin("tool@2.0.0")).toBeUndefined();
      expect(pluginModel.getPlugin("tool@1.0.0")?.version).toBe("1.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin delete prompts for searchable multi-select on TTY and deletes selected plugins", async () => {
    const context = await createTestContext("cli-plugin-delete-multi-select");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");

      await runCli(["plugin", "create", "keep-plugin"]);
      await runCli(["plugin", "create", "delete-a", "--version", "1.0.0"]);
      await runCli(["plugin", "create", "delete-b", "--version", "2.0.0"]);

      const result = await runCli(["plugin", "delete"], {
        isTTY: true,
        promptResponses: [{ value: ["delete-a@1.0.0", "delete-b@2.0.0"] }],
      });

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("delete-a@1.0.0");
      expect(result.stdout).toContain("delete-b@2.0.0");
      expect(pluginModel.getPlugin("delete-a@1.0.0")).toBeUndefined();
      expect(pluginModel.getPlugin("delete-b@2.0.0")).toBeUndefined();
      expect(pluginModel.getPlugin("keep-plugin@1.0.0")?.name).toBe("keep-plugin");
    } finally {
      await context.cleanup();
    }
  });

  it("creates, shows, associates, removes, and deletes plugins", async () => {
    const context = await createTestContext("cli-plugin");

    try {
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const _resource = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "shared-skill",
          description: "Shared helper",
          content: "# Shared",
        }),
      );

      const createResult = await runCli([
        "plugin",
        "create",
        "team",
        "--description",
        "Team plugin",
        "--tags",
        "core,shared",
      ]);
      expect(createResult.stdout).toContain("✓ Created plugin");
      expect(createResult.stdout).toContain("team");

      const createList = await runCli(["plugin", "list"]);
      expect(createList.stdout).toContain("team");

      const addResult = await runCli(["plugin", "edit", "team", "--add", "shared-skill", "--type", "skill", "--no-interactive"]);
      expect(addResult.stdout).toContain("✓ Added");
      expect(addResult.stdout).toContain("skill");
      expect(addResult.stdout).toContain('"shared-skill"');
      expect(addResult.stdout).toContain("team");

      const pluginShow = await runCli(["plugin", "show", "team"]);
      expect(pluginShow.stdout).toContain("team");
      expect(pluginShow.stdout).toContain("shared-skill");

      const removeResult = await runCli(["plugin", "edit", "team", "--remove", "shared-skill", "--type", "skill", "--no-interactive"]);
      expect(removeResult.stdout).toContain("✓ Removed");
      expect(removeResult.stdout).toContain("skill");
      expect(removeResult.stdout).toContain('"shared-skill"');
      expect(removeResult.stdout).toContain("team");

      const teamPlugin = pluginModel.getPlugin("team");
      expect(teamPlugin).toBeDefined();
      if (!teamPlugin) {
        throw new Error("Expected the team plugin to exist after creation");
      }

      expect(pluginModel.getPluginResources(teamPlugin.id)).toHaveLength(0);

      const deleteResult = await runCli(["plugin", "delete", "team"]);
      expect(deleteResult.stdout).toContain("✓ Deleted plugin");
      expect(deleteResult.stdout).toContain("team");

      expect(pluginModel.getPlugin("team")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("plugin show hides resource IDs by default and reveals them with --show-id", async () => {
    const context = await createTestContext("cli-plugin-show-ids");
    try {
      await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "shared-skill",
          description: "Shared helper",
          content: "# Shared",
        }),
      );

      await runCli(["plugin", "create", "team"]);
      await runCli(["plugin", "edit", "team", "--add", "shared-skill", "--type", "skill", "--no-interactive"]);
      const shortId = `${resource.id.slice(0, 6)}…${resource.id.slice(-4)}`;

      const hidden = await runCli(["plugin", "show", "team"]);
      const shown = await runCli(["plugin", "show", "team", "--show-id"]);

      expect(hidden.stdout).toContain("RESOURCES");
      expect(hidden.stdout).not.toMatch(/\|\s+ID\s+\|/);
      expect(hidden.stdout).not.toContain(shortId);
      expect(shown.stdout).toMatch(/\|\s+ID\s+\|/);
      expect(shown.stdout).toContain(shortId);
    } finally {
      await context.cleanup();
    }
  });

  it("renders plugin list as a shared table with a summary footer", async () => {
    const context = await createTestContext("cli-plugin-list-table");
    try {
      await runCli(["init"]);
      await importBuiltinFixtures();
      const result = await runCli(["plugin", "list"], { commandName: "ht" });
      expect(result.stdout).toContain("NAME");
      expect(result.stdout).toContain("DESCRIPTION");
      expect(result.stdout).toContain("run `ht plugin show <name>` for details");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin list --local-only has no Remote catalog section", async () => {
    const context = await createTestContext("cli-plugin-list-local-only");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "team-stack"]);

      const result = await runCli(["plugin", "list", "--local-only", "--no-interactive"]);

      expect(result.stdout).toContain("team-stack");
      expect(result.stdout).not.toContain("Remote catalog");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin list with mock catalog includes Remote catalog section", async () => {
    const context = await createTestContext("cli-plugin-list-remote-section");
    try {
      await runCli(["init"]);
      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
      });

      const result = await runCli([
        "plugin",
        "list",
        "--base-url",
        "https://mock",
        "--no-interactive",
      ]);

      expect(result.stdout).toContain("Remote catalog");

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("renders plugin show as a detail panel with a resource sub-table", async () => {
    const context = await createTestContext("cli-plugin-show-panel");
    try {
      await runCli(["init"]);
      await importBuiltinFixtures();
      const result = await runCli(["plugin", "show", "demo-stack"]);
      expect(result.stdout).toContain("PLUGIN");
      expect(result.stdout).toContain("Description");
      expect(result.stdout).toContain("RESOURCES");
    } finally {
      await context.cleanup();
    }
  });

  it("renders plugin diff as a compact diff table with a summary footer", async () => {
    const context = await createTestContext("cli-plugin-diff-ui");
    try {
      await runCli(["init"]);
      await importBuiltinFixtures();
      const result = await runCli(["plugin", "diff", "demo-stack", "demo-api"]);
      expect(result.stdout).toContain("DIFF");
      expect(result.stdout).toContain("~");
    } finally {
      await context.cleanup();
    }
  });

  it("exits 1 when a diff operand plugin is missing", async () => {
    const context = await createTestContext("cli-plugin-diff-missing");
    try {
      await runCli(["init"]);
      createPlugin({ name: "left" });
      const result = await runCli(["plugin", "diff", "left", "missing-zzz"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Plugin not found: missing-zzz");
    } finally {
      await context.cleanup();
    }
  });

  it("runs plugin doctor and shows all checks with pass markers for healthy plugin", async () => {
    const context = await createTestContext("cli-plugin-doctor-ui");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");
      pluginModel.createPlugin({ name: "healthy-plugin" });

      const result = await runCli(["plugin", "doctor", "healthy-plugin"]);
      expect(result.stdout).toContain("CHECK");
      expect(result.stdout).toContain("RESULT");
      expect(result.stdout).toContain("✓"); // pass marker
      expect(result.stdout).toContain("empty-plugin");
      expect(result.stdout).toContain("duplicate-resources");
      expect(result.stdout).toContain("empty-content");
      expect(result.stdout).toContain("plugin-metadata");
      expect(result.exitCode).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("reports plugin-metadata errors with fail markers and exits with failure", async () => {
    const context = await createTestContext("cli-plugin-doctor-plugin-metadata");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "bad-plugin-meta" });
      // Bypass addDependency validation so doctor can see invalid stored metadata.
      const bad = resourceModel.createResource({
        type: "plugin",
        name: "formatter",
        description: "Dependency: formatter",
        content: "{}",
        metadata: {
          source_kind: "marketplace",
          version_constraint: "not-semver",
          sync_status: "never_synced",
          portable: "reference",
        },
        source: "composition:plugin",
        namespace: "not-semver",
        origin_kind: "marketplace_link",
        origin_ref: "formatter",
      });
      pluginModel.addResourceToPlugin(plugin.id, bad.id);

      const result = await runCli([
        "plugin",
        "doctor",
        "bad-plugin-meta",
        "--check",
        "plugin-metadata",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("CHECK");
      expect(result.stdout).toContain("RESULT");
      expect(result.stdout).toContain("plugin-metadata");
      expect(result.stdout).toContain("✗"); // fail marker
      expect(result.stdout).toContain("Plugin ref must include marketplace: formatter");
      expect(result.stdout).toMatch(/invalid version constraint/i);
    } finally {
      await context.cleanup();
    }
  });

  it("lists doctor checks without requiring a plugin", async () => {
    const context = await createTestContext("cli-plugin-doctor-list-checks");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "plugin",
        "doctor",
        "--list-checks",
        "--format",
        "json",
      ]);

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("duplicate-resources");
      expect(result.stdout).toContain("plugin-metadata");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin doctor prompts for plugin name when omitted on TTY", async () => {
    const context = await createTestContext("cli-plugin-doctor-prompt");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");
      pluginModel.createPlugin({ name: "healthy-plugin" });

      const result = await runCli(["plugin", "doctor"], {
        isTTY: true,
        promptResponses: [{ value: "healthy-plugin" }],
      });

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("CHECK");
      expect(result.stdout).toContain("healthy-plugin");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin doctor fails without prompt when name is omitted in non-interactive mode", async () => {
    const context = await createTestContext("cli-plugin-doctor-no-prompt");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");
      pluginModel.createPlugin({ name: "healthy-plugin" });

      const result = await runCli(["plugin", "doctor"], {
        isTTY: false,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing required argument 'name'");
    } finally {
      await context.cleanup();
    }
  });

  it("narrows plugin doctor to the selected checks", async () => {
    const context = await createTestContext("cli-plugin-doctor-check-filter");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "doctor-filter" });
      const duplicateResourceA = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "shared-doc",
          namespace: "dup-a",
          content: "# Shared A",
        }),
      );
      const duplicateResourceB = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "shared-doc",
          namespace: "dup-b",
          content: "# Shared B",
        }),
      );
      const emptyResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "empty-doc",
          content: "",
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, duplicateResourceA.id);
      pluginModel.addResourceToPlugin(plugin.id, duplicateResourceB.id);
      pluginModel.addResourceToPlugin(plugin.id, emptyResource.id);

      const result = await runCli([
        "plugin",
        "doctor",
        "doctor-filter",
        "--check",
        "duplicate-resources",
      ]);

      expect(result.stdout).toContain("duplicate-resources");
      expect(result.stdout).not.toContain("empty-content");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects unknown plugin validate subcommand", async () => {
    await expect(runCli(["plugin", "validate", "empty-plugin"])).rejects.toMatchObject({
      code: "commander.unknownCommand",
      exitCode: 1,
      message: expect.stringMatching(/unknown command/i),
    } satisfies Partial<CommanderError>);
  });

  it("rejects unknown plugin export subcommand", async () => {
    await expect(runCli(["plugin", "export", "team-setup"])).rejects.toMatchObject({
      code: "commander.unknownCommand",
      exitCode: 1,
      message: expect.stringMatching(/unknown command/i),
    } satisfies Partial<CommanderError>);
  });

  it("rejects unknown plugin import subcommand", async () => {
    await expect(runCli(["plugin", "import", "./team.ap.json"])).rejects.toMatchObject({
      code: "commander.unknownCommand",
      exitCode: 1,
      message: expect.stringMatching(/unknown command/i),
    } satisfies Partial<CommanderError>);
  });

  it("accepts resource names when adding and removing typed plugin resources", async () => {
    const context = await createTestContext("cli-plugin-resource-selector");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "team" });
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );

      await runCli(["plugin", "edit", "team", "--add", "shared-skill", "--type", "skill", "--no-interactive"]);
      expect(pluginModel.getPluginResources(plugin.id)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: resource.id })]),
      );

      await runCli(["plugin", "edit", "team", "--remove", "shared-skill", "--type", "skill", "--no-interactive"]);
      expect(pluginModel.getPluginResources(plugin.id)).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("shows candidate details for ambiguous typed plugin combine resource matches", async () => {
    const context = await createTestContext("cli-plugin-add-ambiguous-resource");
    try {
      await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");
      const first = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "shared-skill",
          namespace: "team-a",
          content: "# Shared A",
        }),
      );
      const second = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "shared-skill",
          namespace: "team-b",
          content: "# Shared B",
        }),
      );
      await runCli(["plugin", "create", "team"]);

      const result = await runCli(["plugin", "edit", "team", "--add", "shared-skill", "--type", "skill", "--no-interactive"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Ambiguous resource name: shared-skill");
      expect(result.stderr).toContain(first.id);
      expect(result.stderr).toContain(second.id);
      expect(result.stderr).toContain("skill");
      expect(result.stderr).toContain("shared-skill");
    } finally {
      await context.cleanup();
    }
  });

  it("shows candidate details for ambiguous typed plugin uncombine resource matches", async () => {
    const context = await createTestContext("cli-plugin-remove-ambiguous-resource");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "team" });
      const first = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "shared-skill",
          namespace: "team-a",
          content: "# Shared A",
        }),
      );
      const second = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "shared-skill",
          namespace: "team-b",
          content: "# Shared B",
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, first.id);
      pluginModel.addResourceToPlugin(plugin.id, second.id);

      const result = await runCli(["plugin", "edit", "team", "--remove", "shared-skill", "--type", "skill", "--no-interactive"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Ambiguous resource name: shared-skill");
      expect(result.stderr).toContain(first.id);
      expect(result.stderr).toContain(second.id);
      expect(result.stderr).toContain("skill");
      expect(result.stderr).toContain("shared-skill");
    } finally {
      await context.cleanup();
    }
  });

  it("requires --type for plugin edit --add", async () => {
    const context = await createTestContext("cli-plugin-add-type-required");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "team"]);

      const result = await runCli(["plugin", "edit", "team", "--add", "shared-skill", "--no-interactive"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Attachment type required");
      expect(result.stderr).toContain("skill:");
      expect(result.stderr).toContain("plugin:");
    } finally {
      await context.cleanup();
    }
  });

  it("auto-prompts plugin edit when the plugin name is missing", async () => {
    const context = await createTestContext("cli-plugin-edit-missing-plugin");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "team" });
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );

      const result = await runCli(["plugin", "edit"], {
        isTTY: true,
        promptResponses: [
          { value: "team@1.0.0" },
          {
            value: [
              {
                id: resource.id,
                type: "skill",
                name: "shared-skill",
                namespace: "",
                display_name: "shared-skill",
                description: "Shared",
                source: "manual",
                origin_kind: "manual",
                origin_ref: "",
                content_hash: "",
                content: "# Shared",
                metadata: {},
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-02T00:00:00.000Z",
                checked: true,
              },
            ],
          },
        ],
      });

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("+1 added");
      expect(result.stdout).toContain("team@1.0.0");
      expect(pluginModel.getPluginResources(plugin.id)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: resource.id })]),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("prints JSON snapshot without prompting when --format json --no-interactive", async () => {
    const context = await createTestContext("cli-plugin-edit-wizard-json");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "team"]);

      const result = await runCli(["plugin", "edit", "team", "--format", "json", "--no-interactive"], {
        isTTY: true,
      });

      expect(result.exitCode ?? 0).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.plugin.name).toBe("team");
      expect(payload.attachments).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("does not launch interactive edit when CI disables interactivity", async () => {
    const context = await createTestContext("cli-plugin-edit-wizard-ci");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "team"]);

      const result = await runCli(["plugin", "edit", "team"], {
        isTTY: true,
        env: { CI: "true" },
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/requires an interactive terminal/i);
    } finally {
      await context.cleanup();
    }
  });

  it("does not launch interactive edit when --no-interactive is requested", async () => {
    const context = await createTestContext("cli-plugin-edit-wizard-disabled");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "team"]);

      const result = await runCli(["plugin", "edit", "team", "--no-interactive"], {
        isTTY: true,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/requires an interactive terminal/i);
      expect(result.stderr).toContain("--add");
    } finally {
      await context.cleanup();
    }
  });

  it("requires --type for plugin edit --remove", async () => {
    const context = await createTestContext("cli-plugin-remove-type-required");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "team"]);

      const result = await runCli(["plugin", "edit", "team", "--remove", "shared-skill", "--no-interactive"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Attachment type required");
      expect(result.stderr).toContain("skill:");
      expect(result.stderr).toContain("plugin:");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects invalid --type for plugin edit --remove", async () => {
    const context = await createTestContext("cli-plugin-remove-type-invalid");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "team"]);

      const result = await runCli(["plugin", "edit", "team", "--remove", "shared-skill", "--type", "not-a-real-type", "--no-interactive"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid --type. Valid:");
      expect(result.stderr).toContain("plugin");
      expect(result.stderr).not.toContain("layer-dependency");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects mismatched resource type selectors", async () => {
    const context = await createTestContext("cli-plugin-add-resource-type-mismatch");
    try {
      await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");
      resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );
      await runCli(["plugin", "create", "team"]);

      const result = await runCli(["plugin", "edit", "team", "--add", "shared-skill", "--type", "instruction", "--no-interactive"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Type mismatch");
      expect(result.stderr).toContain("expected instruction");
      expect(result.stderr).toContain("resolved to skill");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects --version and --embed for resource attachments", async () => {
    const context = await createTestContext("cli-plugin-add-resource-invalid-flags");
    try {
      await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");
      resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );
      await runCli(["plugin", "create", "team"]);

      const versionResult = await runCli(["plugin", "edit", "team", "--add", "shared-skill", "--type", "skill", "--version", "^1.0.0", "--no-interactive"]);
      expect(versionResult.exitCode).toBe(1);
      expect(versionResult.stderr).toContain("--version is only supported for plugin attachments");

      const embedResult = await runCli(["plugin", "edit", "team", "--add", "shared-skill", "--type", "skill", "--embed", "--no-interactive"]);
      expect(embedResult.exitCode).toBe(1);
      expect(embedResult.stderr).toContain("--embed is only supported for plugin attachments");
    } finally {
      await context.cleanup();
    }
  });

  it("allows --embed for local plugin dependencies", async () => {
    const context = await createTestContext("cli-plugin-dependency-embed");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "team-stack", "--version", "1.2.0"]);
      await runCli(["plugin", "create", "baseline", "--version", "1.0.0"]);

      const result = await runCli(["plugin", "edit", "team-stack@1.2.0", "--add", "baseline", "--type", "plugin", "--version", "^1.0.0", "--embed", "--no-interactive"]);

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("Attached plugin");
    } finally {
      await context.cleanup();
    }
  });

  it("adds and removes plugin pins with typed verdicts", async () => {
    const context = await createTestContext("cli-plugin-plugin-verdicts");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "plugin-test"]);

      const addResult = await runCli(["plugin", "edit", "plugin-test", "--add", "formatter@marketplace", "--type", "plugin_pin", "--version", "^2.1.0", "--no-interactive"]);
      expect(addResult.stdout).toContain("✓ Attached plugin");
      expect(addResult.stdout).toContain("formatter@marketplace");
      expect(addResult.stdout).toContain("^2.1.0");
      expect(addResult.stdout).toContain("plugin-test");

      const removeResult = await runCli(["plugin", "edit", "plugin-test", "--remove", "formatter@marketplace", "--type", "plugin_pin", "--no-interactive"]);
      expect(removeResult.stdout).toContain("✓ Removed plugin");
      expect(removeResult.stdout).toContain("formatter@marketplace");
      expect(removeResult.stdout).toContain("plugin-test");
    } finally {
      await context.cleanup();
    }
  });
});
