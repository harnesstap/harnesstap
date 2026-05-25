import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI preset", () => {
  it("creates a preset with an explicit version via --version", async () => {
    const context = await createTestContext("cli-preset-version");
    try {
      await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");

      await runCli(["preset", "create", "versioned-preset", "--version", "2.3.0"]);

      const preset = presetModel.getPreset("versioned-preset");
      expect(preset).toBeDefined();
      expect(preset?.version).toBe("2.3.0");
    } finally {
      await context.cleanup();
    }
  });

  it("preset list shows name@version and distinguishes multiple versions", async () => {
    const context = await createTestContext("cli-preset-list-versions");
    try {
      await runCli(["init"]);

      await runCli(["preset", "create", "team-stack", "--version", "1.0.0"]);
      await runCli(["preset", "create", "team-stack", "--version", "2.0.0"]);

      const listResult = await runCli(["preset", "list"]);
      expect(listResult.stdout).toContain("team-stack@1.0.0");
      expect(listResult.stdout).toContain("team-stack@2.0.0");
      // Both versions must appear as separate lines, not collapsed into one
      const teamStackLines = listResult.stdout
        .split("\n")
        .filter((line) => line.includes("team-stack@"));
      expect(teamStackLines).toHaveLength(2);
    } finally {
      await context.cleanup();
    }
  });

  it("preset show displays name@version and dependencies", async () => {
    const context = await createTestContext("cli-preset-show-version");
    try {
      await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");

      await runCli(["preset", "create", "team-stack", "--version", "1.2.0"]);
      const preset = presetModel.getPreset("team-stack");
      if (!preset) throw new Error("Expected preset to exist");

      presetModel.addDependencyToPreset(preset.id, "baseline", "^1.0.0");
      presetModel.addDependencyToPreset(preset.id, "extras", ">=2.0.0");

      const showResult = await runCli(["preset", "show", "team-stack@1.2.0"]);
      expect(showResult.stdout).toContain("team-stack@1.2.0");
      expect(showResult.stdout).toContain("baseline");
      expect(showResult.stdout).toContain("^1.0.0");
      expect(showResult.stdout).toContain("extras");
      expect(showResult.stdout).toContain(">=2.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("preset add-dependency and remove-dependency manage dependencies via CLI", async () => {
    const context = await createTestContext("cli-preset-dependency");
    try {
      await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");

      await runCli(["preset", "create", "team-stack", "--version", "1.2.0"]);

      await runCli([
        "preset", "add-dependency",
        "team-stack@1.2.0",
        "baseline",
        "--version", "^1.0.0",
      ]);

      const preset = presetModel.getPreset("team-stack@1.2.0");
      if (!preset) throw new Error("Expected preset to exist");

      const deps = presetModel.listPresetDependencies(preset.id);
      expect(deps).toHaveLength(1);
      expect(deps[0].dependency_name).toBe("baseline");
      expect(deps[0].version_constraint).toBe("^1.0.0");

      await runCli(["preset", "remove-dependency", "team-stack@1.2.0", "baseline"]);

      const afterRemove = presetModel.listPresetDependencies(preset.id);
      expect(afterRemove).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("add-dependency reports error for invalid preset selector instead of crashing", async () => {
    const context = await createTestContext("cli-preset-dep-invalid-selector");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "preset", "add-dependency",
        "team-stack@not-semver",
        "baseline",
        "--version", "^1.0.0",
      ]);

      expect(result.stderr).toMatch(/invalid version constraint/i);
      expect(result.stdout).not.toContain("Added dependency");
    } finally {
      await context.cleanup();
    }
  });

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
      expect(presetShow.stdout).toContain(resource.id);

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
