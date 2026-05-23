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

      await runCli([
        "preset",
        "create",
        "team",
        "--description",
        "Team preset",
        "--tags",
        "core,shared",
      ]);
      await runCli(["preset", "add", "team", resource.id]);

      const presetShow = await runCli(["preset", "show", "team"]);
      expect(presetShow.stdout).toContain("team");
      expect(presetShow.stdout).toContain("shared-skill");
      // IDs are shortened in human-mode panel output (first 6 chars always visible)
      expect(presetShow.stdout).toContain(resource.id.slice(0, 6));

      await runCli(["preset", "remove", "team", resource.id]);
      const teamPreset = presetModel.getPreset("team");
      expect(teamPreset).toBeDefined();
      if (!teamPreset) {
        throw new Error("Expected the team preset to exist after creation");
      }

      expect(presetModel.getPresetResources(teamPreset.id)).toHaveLength(0);

      await runCli(["preset", "delete", "team"]);
      expect(presetModel.getPreset("team")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("renders preset list as a shared table with a summary footer", async () => {
    const context = await createTestContext("cli-preset-list-table");
    try {
      await runCli(["init"]);
      const result = await runCli(["preset", "list"]);
      expect(result.stdout).toContain("NAME");
      expect(result.stdout).toContain("DESCRIPTION");
      expect(result.stdout).toContain("run `harnessdeck preset show <name>` for details");
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
});
