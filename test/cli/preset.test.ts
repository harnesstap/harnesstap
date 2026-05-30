import { describe, expect, it } from "bun:test";
import type { CommanderError } from "commander";
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

  it("preset list shows separate name and version columns", async () => {
    const context = await createTestContext("cli-preset-list-versions");
    try {
      await runCli(["init"]);

      await runCli(["preset", "create", "team-stack", "--version", "1.0.0"]);
      await runCli(["preset", "create", "team-stack", "--version", "2.0.0"]);

      const listResult = await runCli(["preset", "list"]);
      expect(listResult.stdout).toContain("NAME");
      expect(listResult.stdout).toContain("VERSION");
      expect(listResult.stdout).toContain("DESCRIPTION");
      expect(listResult.stdout).not.toContain("team-stack@1.0.0");
      expect(listResult.stdout).not.toContain("team-stack@2.0.0");
      expect(listResult.stdout).toMatch(/team-stack\s+\|\s+1\.0\.0/);
      expect(listResult.stdout).toMatch(/team-stack\s+\|\s+2\.0\.0/);
    } finally {
      await context.cleanup();
    }
  });

  it("preset list hides IDs by default and reveals them with --show-id", async () => {
    const context = await createTestContext("cli-preset-list-show-id");
    try {
      await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");

      await runCli(["preset", "create", "team-stack", "--version", "1.0.0"]);
      const preset = presetModel.getPreset("team-stack");
      if (!preset) throw new Error("Expected preset to exist");
      const shortId = `${preset.id.slice(0, 6)}…${preset.id.slice(-4)}`;

      const hidden = await runCli(["preset", "list"]);
      const shown = await runCli(["preset", "list", "--show-id"]);

      expect(hidden.stdout).not.toMatch(/\|\s+ID\s+\|/);
      expect(hidden.stdout).not.toContain(shortId);
      expect(shown.stdout).toMatch(/\|\s+ID\s+\|/);
      expect(shown.stdout).toContain(shortId);
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

  it("preset show prompts for preset name when omitted on TTY", async () => {
    const context = await createTestContext("cli-preset-show-prompt");
    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "team-stack", "--version", "1.2.0"]);
      await runCli(["preset", "create", "baseline", "--version", "1.0.0"]);

      const result = await runCli(["preset", "show"], {
        isTTY: true,
        promptResponses: [{ value: "team-stack@1.2.0" }],
      });

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("team-stack@1.2.0");
    } finally {
      await context.cleanup();
    }
  });

  it("preset show fails without prompt when name is omitted in non-interactive mode", async () => {
    const context = await createTestContext("cli-preset-show-no-prompt");
    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "team-stack"]);

      const result = await runCli(["preset", "show"], {
        isTTY: false,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing required argument 'name'");
    } finally {
      await context.cleanup();
    }
  });


  it("preset attach/detach --type preset-dependency manage dependencies via CLI", async () => {
    const context = await createTestContext("cli-preset-dependency");
    try {
      await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");

      await runCli(["preset", "create", "team-stack", "--version", "1.2.0"]);

      await runCli([
        "preset", "attach",
        "team-stack@1.2.0",
        "baseline",
        "--type", "preset-dependency",
        "--version", "^1.0.0",
      ]);

      const preset = presetModel.getPreset("team-stack@1.2.0");
      if (!preset) throw new Error("Expected preset to exist");

      const deps = presetModel.listPresetDependencies(preset.id);
      expect(deps).toHaveLength(1);
      expect(deps[0].dependency_name).toBe("baseline");
      expect(deps[0].version_constraint).toBe("^1.0.0");

      await runCli([
        "preset",
        "detach",
        "team-stack@1.2.0",
        "baseline",
        "--type",
        "preset-dependency",
      ]);

      const afterRemove = presetModel.listPresetDependencies(preset.id);
      expect(afterRemove).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("preset attach --type preset-dependency reports error for invalid preset selector instead of crashing", async () => {
    const context = await createTestContext("cli-preset-dep-invalid-selector");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "preset", "attach",
        "team-stack@not-semver",
        "baseline",
        "--type", "preset-dependency",
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

  it("preset attach --type preset-dependency sets a failing exit code when the preset is missing", async () => {
    const context = await createTestContext("cli-preset-dep-missing-preset");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "preset",
        "attach",
        "missing-preset",
        "baseline",
        "--type",
        "preset-dependency",
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

  it("preset attach --type preset-dependency sets a failing exit code for an invalid version constraint", async () => {
    const context = await createTestContext("cli-preset-dep-invalid-version");
    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "team-stack", "--version", "1.2.0"]);

      const result = await runCli([
        "preset",
        "attach",
        "team-stack@1.2.0",
        "baseline",
        "--type",
        "preset-dependency",
        "--version",
        "not-semver",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/invalid version constraint/i);
    } finally {
      await context.cleanup();
    }
  });

  it("preset detach --type preset-dependency sets a failing exit code when the preset is missing", async () => {
    const context = await createTestContext("cli-preset-remove-dep-missing-preset");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "preset",
        "detach",
        "missing-preset",
        "baseline",
        "--type",
        "preset-dependency",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/preset not found: missing-preset/i);
    } finally {
      await context.cleanup();
    }
  });

  it("preset detach --type preset-dependency sets a failing exit code when the dependency is missing", async () => {
    const context = await createTestContext("cli-preset-remove-dep-missing-dependency");
    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "team-stack", "--version", "1.2.0"]);

      const result = await runCli([
        "preset",
        "detach",
        "team-stack@1.2.0",
        "baseline",
        "--type",
        "preset-dependency",
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

      const addResult = await runCli([
        "preset",
        "attach",
        "team",
        resource.id,
        "--type",
        "skill",
      ]);
      expect(addResult.stdout).toContain("✓ Added");
      expect(addResult.stdout).toContain("skill");
      expect(addResult.stdout).toContain('"shared-skill"');
      expect(addResult.stdout).toContain("team");

      const presetShow = await runCli(["preset", "show", "team"]);
      expect(presetShow.stdout).toContain("team");
      expect(presetShow.stdout).toContain("shared-skill");

      const removeResult = await runCli([
        "preset",
        "detach",
        "team",
        resource.id,
        "--type",
        "skill",
      ]);
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

  it("preset show hides resource IDs by default and reveals them with --show-id", async () => {
    const context = await createTestContext("cli-preset-show-ids");
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

      await runCli(["preset", "create", "team"]);
      await runCli(["preset", "attach", "team", resource.id, "--type", "skill"]);
      const shortId = `${resource.id.slice(0, 6)}…${resource.id.slice(-4)}`;

      const hidden = await runCli(["preset", "show", "team"]);
      const shown = await runCli(["preset", "show", "team", "--show-id"]);

      expect(hidden.stdout).toContain("RESOURCES");
      expect(hidden.stdout).not.toMatch(/\|\s+ID\s+\|/);
      expect(hidden.stdout).not.toContain(shortId);
      expect(shown.stdout).toMatch(/\|\s+ID\s+\|/);
      expect(shown.stdout).toContain(shortId);
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

  it("runs preset doctor and renders the severity table", async () => {
    const context = await createTestContext("cli-preset-doctor-ui");
    try {
      await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");
      presetModel.createPreset({ name: "empty-preset" });

      const result = await runCli(["preset", "doctor", "empty-preset"]);
      expect(result.stdout).toContain("SEVERITY");
      expect(result.stdout).toContain("empty-preset");
      expect(result.exitCode).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("reports plugin-metadata errors and exits with failure", async () => {
    const context = await createTestContext("cli-preset-doctor-plugin-metadata");
    try {
      await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");
      const pluginModel = await import("../../src/models/plugin.ts");
      const preset = presetModel.createPreset({ name: "bad-plugin-meta" });
      pluginModel.addPluginToPreset(preset.id, "formatter", "not-semver");

      const result = await runCli([
        "preset",
        "doctor",
        "bad-plugin-meta",
        "--check",
        "plugin-metadata",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("plugin-metadata");
      expect(result.stdout).toContain("Plugin ref must include marketplace: formatter");
      expect(result.stdout).toMatch(/invalid version constraint/i);
    } finally {
      await context.cleanup();
    }
  });

  it("lists doctor checks without requiring a preset", async () => {
    const context = await createTestContext("cli-preset-doctor-list-checks");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "preset",
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

  it("narrows preset doctor to the selected checks", async () => {
    const context = await createTestContext("cli-preset-doctor-check-filter");
    try {
      await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const preset = presetModel.createPreset({ name: "doctor-filter" });
      const duplicateResourceA = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "shared-doc",
          content: "# Shared A",
        }),
      );
      const duplicateResourceB = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "shared-doc",
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
      presetModel.addResourceToPreset(preset.id, duplicateResourceA.id);
      presetModel.addResourceToPreset(preset.id, duplicateResourceB.id);
      presetModel.addResourceToPreset(preset.id, emptyResource.id);

      const result = await runCli([
        "preset",
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

  it("rejects the removed preset validate command", async () => {
    await expect(runCli(["preset", "validate", "empty-preset"])).rejects.toMatchObject({
      code: "commander.unknownCommand",
      exitCode: 1,
      message: expect.stringMatching(/unknown command/i),
    } satisfies Partial<CommanderError>);
  });

  it("accepts resource names when adding and removing typed preset resources", async () => {
    const context = await createTestContext("cli-preset-resource-selector");
    try {
      await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const preset = presetModel.createPreset({ name: "team" });
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );

      await runCli(["preset", "attach", "team", "shared-skill", "--type", "skill"]);
      expect(presetModel.getPresetResources(preset.id)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: resource.id })]),
      );

      await runCli(["preset", "detach", "team", "shared-skill", "--type", "skill"]);
      expect(presetModel.getPresetResources(preset.id)).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("shows candidate details for ambiguous typed preset attach resource matches", async () => {
    const context = await createTestContext("cli-preset-add-ambiguous-resource");
    try {
      await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");
      const first = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared A" }),
      );
      const second = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared B" }),
      );
      await runCli(["preset", "create", "team"]);

      const result = await runCli([
        "preset",
        "attach",
        "team",
        "shared-skill",
        "--type",
        "skill",
      ]);

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

  it("shows candidate details for ambiguous typed preset detach resource matches", async () => {
    const context = await createTestContext("cli-preset-remove-ambiguous-resource");
    try {
      await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const preset = presetModel.createPreset({ name: "team" });
      const first = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared A" }),
      );
      const second = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared B" }),
      );
      presetModel.addResourceToPreset(preset.id, first.id);
      presetModel.addResourceToPreset(preset.id, second.id);

      const result = await runCli([
        "preset",
        "detach",
        "team",
        "shared-skill",
        "--type",
        "skill",
      ]);

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

  it("requires --type for preset attach", async () => {
    const context = await createTestContext("cli-preset-add-type-required");
    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "team"]);

      const result = await runCli(["preset", "attach", "team", "shared-skill"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--type is required");
      expect(result.stderr).toContain("instruction");
      expect(result.stderr).toContain("plugin");
      expect(result.stderr).toContain("preset-dependency");
    } finally {
      await context.cleanup();
    }
  });

  it("auto-prompts preset attach on a TTY when required args are missing", async () => {
    const context = await createTestContext("cli-preset-add-wizard");
    try {
      await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );
      await runCli(["preset", "create", "team"]);

      const result = await runCli(["preset", "attach", "team"], {
        isTTY: true,
        promptResponses: [
          { value: "resource" },
          { value: "skill" },
          { value: resource.id },
        ],
      });

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("Added");
      expect(result.stdout).toContain('"shared-skill"');
    } finally {
      await context.cleanup();
    }
  });

  it("auto-prompts preset attach for the preset when the preset name is missing", async () => {
    const context = await createTestContext("cli-preset-add-missing-preset");
    try {
      await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const preset = presetModel.createPreset({ name: "team" });
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );

      const result = await runCli(["preset", "attach"], {
        isTTY: true,
        promptResponses: [
          { value: "team@1.0.0" },
          { value: "resource" },
          { value: "skill" },
          { value: resource.id },
        ],
      });

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("Added");
      expect(result.stdout).toContain('"shared-skill"');
      expect(presetModel.getPresetResources(preset.id)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: resource.id })]),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("does not auto-prompt preset attach when --format json is requested", async () => {
    const context = await createTestContext("cli-preset-add-wizard-json");
    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "team"]);

      const result = await runCli(["preset", "attach", "team", "--format", "json"], {
        isTTY: true,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing required argument 'selector'");
    } finally {
      await context.cleanup();
    }
  });

  it("does not auto-prompt preset attach when CI disables interactivity", async () => {
    const context = await createTestContext("cli-preset-add-wizard-ci");
    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "team"]);

      const result = await runCli(["preset", "attach", "team"], {
        isTTY: true,
        env: { CI: "true" },
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing required argument 'selector'");
    } finally {
      await context.cleanup();
    }
  });

  it("does not auto-prompt preset attach when --no-interactive is requested", async () => {
    const context = await createTestContext("cli-preset-add-wizard-disabled");
    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "team"]);

      const result = await runCli(["--no-interactive", "preset", "attach", "team"], {
        isTTY: true,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing required argument 'selector'");
    } finally {
      await context.cleanup();
    }
  });

  it("requires --type for preset detach", async () => {
    const context = await createTestContext("cli-preset-remove-type-required");
    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "team"]);

      const result = await runCli(["preset", "detach", "team", "shared-skill"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--type is required");
      expect(result.stderr).toContain("instruction");
      expect(result.stderr).toContain("plugin");
      expect(result.stderr).toContain("preset-dependency");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects invalid --type for preset detach", async () => {
    const context = await createTestContext("cli-preset-remove-type-invalid");
    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "team"]);

      const result = await runCli([
        "preset",
        "detach",
        "team",
        "shared-skill",
        "--type",
        "not-a-real-type",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid --type. Valid:");
      expect(result.stderr).toContain("plugin");
      expect(result.stderr).toContain("preset-dependency");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects mismatched resource type selectors", async () => {
    const context = await createTestContext("cli-preset-add-resource-type-mismatch");
    try {
      await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");
      resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );
      await runCli(["preset", "create", "team"]);

      const result = await runCli([
        "preset",
        "attach",
        "team",
        "shared-skill",
        "--type",
        "instruction",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Type mismatch");
      expect(result.stderr).toContain("expected instruction");
      expect(result.stderr).toContain("resolved to skill");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects --version and --embed for resource attachments", async () => {
    const context = await createTestContext("cli-preset-add-resource-invalid-flags");
    try {
      await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");
      resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );
      await runCli(["preset", "create", "team"]);

      const versionResult = await runCli([
        "preset",
        "attach",
        "team",
        "shared-skill",
        "--type",
        "skill",
        "--version",
        "^1.0.0",
      ]);
      expect(versionResult.exitCode).toBe(1);
      expect(versionResult.stderr).toContain("--version is only supported for --type plugin and --type preset-dependency");

      const embedResult = await runCli([
        "preset",
        "attach",
        "team",
        "shared-skill",
        "--type",
        "skill",
        "--embed",
      ]);
      expect(embedResult.exitCode).toBe(1);
      expect(embedResult.stderr).toContain("--embed is only supported for --type plugin");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects --embed for preset dependencies", async () => {
    const context = await createTestContext("cli-preset-dependency-embed-invalid");
    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "team-stack", "--version", "1.2.0"]);

      const result = await runCli([
        "preset",
        "attach",
        "team-stack@1.2.0",
        "baseline",
        "--type",
        "preset-dependency",
        "--version",
        "^1.0.0",
        "--embed",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--embed is only supported for --type plugin");
    } finally {
      await context.cleanup();
    }
  });

  it("legacy add-dependency and remove-dependency commands emit deprecation warnings and forward", async () => {
    const context = await createTestContext("cli-preset-dependency-legacy-forward");
    try {
      await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");
      await runCli(["preset", "create", "team-stack", "--version", "1.2.0"]);

      const addResult = await runCli([
        "preset",
        "add-dependency",
        "team-stack@1.2.0",
        "baseline",
        "--version",
        "^1.0.0",
      ]);
      expect(addResult.stdout).toContain("`preset add-dependency` is deprecated; use `preset attach ... --type preset-dependency` instead.");

      const preset = presetModel.getPreset("team-stack@1.2.0");
      if (!preset) throw new Error("Expected preset to exist");
      expect(presetModel.listPresetDependencies(preset.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ dependency_name: "baseline", version_constraint: "^1.0.0" }),
        ]),
      );

      const removeResult = await runCli([
        "preset",
        "remove-dependency",
        "team-stack@1.2.0",
        "baseline",
      ]);
      expect(removeResult.stdout).toContain("`preset remove-dependency` is deprecated; use `preset detach ... --type preset-dependency` instead.");
      expect(presetModel.listPresetDependencies(preset.id)).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("adds and removes plugin pins with typed verdicts", async () => {
    const context = await createTestContext("cli-preset-plugin-verdicts");
    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "plugin-test"]);

      const addResult = await runCli([
        "preset",
        "attach",
        "plugin-test",
        "formatter@marketplace",
        "--type",
        "plugin",
        "--version",
        "^2.1.0",
      ]);
      expect(addResult.stdout).toContain("✓ Pinned");
      expect(addResult.stdout).toContain("formatter@marketplace");
      expect(addResult.stdout).toContain("^2.1.0");
      expect(addResult.stdout).toContain("plugin-test");

      const removeResult = await runCli([
        "preset",
        "detach",
        "plugin-test",
        "formatter@marketplace",
        "--type",
        "plugin",
      ]);
      expect(removeResult.stdout).toContain("✓ Removed plugin pin");
      expect(removeResult.stdout).toContain("formatter@marketplace");
      expect(removeResult.stdout).toContain("plugin-test");
    } finally {
      await context.cleanup();
    }
  });
});
