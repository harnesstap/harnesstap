import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI preset", () => {
  it("creates, shows, associates, removes, and deletes presets", async () => {
    const context = await createTestContext("cli-preset");

    try {
      await runCli(["init"]);

      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "shared-skill",
          description: "Shared helper",
          content: "# Shared",
        }),
      );

      const createResult = await runCli([
        "preset",
        "create",
        "team",
        "--description",
        "Team preset",
        "--tags",
        "core,shared",
      ]);
      expect(createResult.stdout).toContain("✓ Created preset");
      expect(createResult.stdout).toContain("team");

      const createList = await runCli(["preset", "list"]);
      expect(createList.stdout).toContain("team");

      const addResult = await runCli(["preset", "add", "team", resource.id]);
      expect(addResult.stdout).toContain("✓ Added");
      expect(addResult.stdout).toContain("skill");
      expect(addResult.stdout).toContain('"shared-skill"');
      expect(addResult.stdout).toContain("team");

      const presetShow = await runCli(["preset", "show", "team"]);
      expect(presetShow.stdout).toContain("team");
      expect(presetShow.stdout).toContain("shared-skill");
      // IDs are shortened in human-mode panel output (first 6 chars always visible)
      expect(presetShow.stdout).toContain(resource.id.slice(0, 6));

      const removeResult = await runCli(["preset", "remove", "team", resource.id]);
      expect(removeResult.stdout).toContain("✓ Removed");
      expect(removeResult.stdout).toContain("skill");
      expect(removeResult.stdout).toContain('"shared-skill"');
      expect(removeResult.stdout).toContain("team");

      const teamPreset = presetModel.getPreset("team");
      expect(teamPreset).toBeDefined();
      if (!teamPreset) {
        throw new Error("Expected the team preset to exist after creation");
      }

      expect(presetModel.getPresetResources(teamPreset.id)).toHaveLength(0);

      const deleteResult = await runCli(["preset", "delete", "team"]);
      expect(deleteResult.stdout).toContain("✓ Deleted preset");
      expect(deleteResult.stdout).toContain("team");

      expect(presetModel.getPreset("team")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("renders preset list as a shared table with a summary footer", async () => {
    const context = await createTestContext("cli-preset-list-table");
    try {
      await runCli(["init"]);
      const result = await runCli(["preset", "list"], { commandName: "hd" });
      expect(result.stdout).toContain("NAME");
      expect(result.stdout).toContain("DESCRIPTION");
      expect(result.stdout).toContain("run `hd preset show <name>` for details");
    } finally {
      await context.cleanup();
    }
  });

  it("renders preset show as a detail panel with a resource sub-table", async () => {
    const context = await createTestContext("cli-preset-show-panel");
    try {
      await runCli(["init"]);
      const result = await runCli(["preset", "show", "nextjs-fullstack"]);
      expect(result.stdout).toContain("PRESET");
      expect(result.stdout).toContain("Description");
      expect(result.stdout).toContain("RESOURCES");
    } finally {
      await context.cleanup();
    }
  });

  it("renders preset diff as a compact diff table with a summary footer", async () => {
    const context = await createTestContext("cli-preset-diff-ui");
    try {
      await runCli(["init"]);
      const result = await runCli(["preset", "diff", "nextjs-fullstack", "python-fastapi"]);
      expect(result.stdout).toContain("DIFF");
      expect(result.stdout).toContain("~");
    } finally {
      await context.cleanup();
    }
  });

  it("renders preset validate warnings as a severity table", async () => {
    const context = await createTestContext("cli-preset-validate-ui");
    try {
      await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");
      presetModel.createPreset({ name: "empty-preset" });
      const result = await runCli(["preset", "validate", "empty-preset"]);
      expect(result.stdout).toContain("SEVERITY");
      expect(result.stdout).toContain("empty_preset");
    } finally {
      await context.cleanup();
    }
  });

  it("accepts resource names when adding and removing preset resources", async () => {
    const context = await createTestContext("cli-preset-resource-selector");
    try {
      await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const preset = presetModel.createPreset({ name: "team" });
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );

      await runCli(["preset", "add", "team", "shared-skill"]);
      expect(presetModel.getPresetResources(preset.id)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: resource.id })]),
      );

      await runCli(["preset", "remove", "team", "shared-skill"]);
      expect(presetModel.getPresetResources(preset.id)).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("adds and removes plugin pins with verdicts", async () => {
    const context = await createTestContext("cli-preset-plugin-verdicts");
    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "plugin-test"]);

      const addResult = await runCli([
        "preset",
        "add-plugin",
        "plugin-test",
        "formatter@marketplace",
        "--version",
        "^2.1.0",
      ]);
      expect(addResult.stdout).toContain("✓ Pinned");
      expect(addResult.stdout).toContain("formatter@marketplace");
      expect(addResult.stdout).toContain("^2.1.0");
      expect(addResult.stdout).toContain("plugin-test");

      const removeResult = await runCli([
        "preset",
        "remove-plugin",
        "plugin-test",
        "formatter@marketplace",
      ]);
      expect(removeResult.stdout).toContain("✓ Removed plugin pin");
      expect(removeResult.stdout).toContain("formatter@marketplace");
      expect(removeResult.stdout).toContain("plugin-test");
    } finally {
      await context.cleanup();
    }
  });
});
