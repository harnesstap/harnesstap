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

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/invalid version constraint/i);
      expect(result.stderr).not.toMatch(/preset not found/i);
      expect(result.stdout).not.toContain("Added dependency");
    } finally {
      await context.cleanup();
    }
  });

  it("add-dependency sets a failing exit code when the preset is missing", async () => {
    const context = await createTestContext("cli-preset-dep-missing-preset");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "preset",
        "add-dependency",
        "missing-preset",
        "baseline",
        "--version",
        "^1.0.0",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/preset not found: missing-preset/i);
      expect(result.stdout).not.toContain("Added dependency");
    } finally {
      await context.cleanup();
    }
  });

  it("add-dependency sets a failing exit code for an invalid version constraint", async () => {
    const context = await createTestContext("cli-preset-dep-invalid-version");
    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "team-stack", "--version", "1.2.0"]);

      const result = await runCli([
        "preset",
        "add-dependency",
        "team-stack@1.2.0",
        "baseline",
        "--version",
        "not-semver",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/invalid version constraint/i);
    } finally {
      await context.cleanup();
    }
  });

  it("remove-dependency sets a failing exit code when the preset is missing", async () => {
    const context = await createTestContext("cli-preset-remove-dep-missing-preset");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "preset",
        "remove-dependency",
        "missing-preset",
        "baseline",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/preset not found: missing-preset/i);
    } finally {
      await context.cleanup();
    }
  });

  it("remove-dependency sets a failing exit code when the dependency is missing", async () => {
    const context = await createTestContext("cli-preset-remove-dep-missing-dependency");
    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "team-stack", "--version", "1.2.0"]);

      const result = await runCli([
        "preset",
        "remove-dependency",
        "team-stack@1.2.0",
        "baseline",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/dependency "baseline" not found/i);
    } finally {
      await context.cleanup();
    }
  });

  it("preset delete reports invalid selectors and exits with failure", async () => {
    const context = await createTestContext("cli-preset-delete-invalid-selector");
    try {
      await runCli(["init"]);

      const result = await runCli(["preset", "delete", "tool@not-semver"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/invalid version constraint/i);
      expect(result.stderr).not.toMatch(/preset not found/i);
    } finally {
      await context.cleanup();
    }
  });

  it("preset delete sets a failing exit code when the preset is missing", async () => {
    const context = await createTestContext("cli-preset-delete-missing");
    try {
      await runCli(["init"]);

      const result = await runCli(["preset", "delete", "missing-preset"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/preset not found: missing-preset/i);
    } finally {
      await context.cleanup();
    }
  });

  it("preset delete accepts a versioned selector and deletes only that version", async () => {
    const context = await createTestContext("cli-preset-delete-version-selector");
    try {
      await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");

      await runCli(["preset", "create", "tool", "--version", "1.0.0"]);
      await runCli(["preset", "create", "tool", "--version", "2.0.0"]);

      const result = await runCli(["preset", "delete", "tool@1.0.0"]);

      expect(result.exitCode ?? 0).toBe(0);
      expect(presetModel.getPreset("tool@1.0.0")).toBeUndefined();
      expect(presetModel.getPreset("tool@2.0.0")?.version).toBe("2.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("preset delete by plain name reports the deleted latest version", async () => {
    const context = await createTestContext("cli-preset-delete-latest-version");
    try {
      await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");

      await runCli(["preset", "create", "tool", "--version", "1.0.0"]);
      await runCli(["preset", "create", "tool", "--version", "2.0.0"]);

      const result = await runCli(["preset", "delete", "tool"]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain("tool@2.0.0");
      expect(presetModel.getPreset("tool@2.0.0")).toBeUndefined();
      expect(presetModel.getPreset("tool@1.0.0")?.version).toBe("1.0.0");
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
