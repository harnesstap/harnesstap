import { describe, expect, it } from "bun:test";
import type { CommanderError } from "commander";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI layer", () => {
  it("creates a layer with an explicit version via --version", async () => {
    const context = await createTestContext("cli-layer-version");
    try {
      await runCli(["init"]);
      const layerModel = await import("../../src/models/layer.ts");

      await runCli(["layer", "create", "versioned-layer", "--version", "2.3.0"]);

      const layer = layerModel.getLayer("versioned-layer");
      expect(layer).toBeDefined();
      expect(layer?.version).toBe("2.3.0");
    } finally {
      await context.cleanup();
    }
  });

  it("layer list shows separate name and version columns", async () => {
    const context = await createTestContext("cli-layer-list-versions");
    try {
      await runCli(["init"]);

      await runCli(["layer", "create", "team-stack", "--version", "1.0.0"]);
      await runCli(["layer", "create", "team-stack", "--version", "2.0.0"]);

      const listResult = await runCli(["layer", "list"]);
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

  it("layer list hides IDs by default and reveals them with --show-id", async () => {
    const context = await createTestContext("cli-layer-list-show-id");
    try {
      await runCli(["init"]);
      const layerModel = await import("../../src/models/layer.ts");

      await runCli(["layer", "create", "team-stack", "--version", "1.0.0"]);
      const layer = layerModel.getLayer("team-stack");
      if (!layer) throw new Error("Expected layer to exist");
      const shortId = `${layer.id.slice(0, 6)}…${layer.id.slice(-4)}`;

      const hidden = await runCli(["layer", "list"]);
      const shown = await runCli(["layer", "list", "--show-id"]);

      expect(hidden.stdout).not.toMatch(/\|\s+ID\s+\|/);
      expect(hidden.stdout).not.toContain(shortId);
      expect(shown.stdout).toMatch(/\|\s+ID\s+\|/);
      expect(shown.stdout).toContain(shortId);
    } finally {
      await context.cleanup();
    }
  });

  it("layer show displays name@version and dependencies", async () => {
    const context = await createTestContext("cli-layer-show-version");
    try {
      await runCli(["init"]);
      const layerModel = await import("../../src/models/layer.ts");

      await runCli(["layer", "create", "team-stack", "--version", "1.2.0"]);
      const layer = layerModel.getLayer("team-stack");
      if (!layer) throw new Error("Expected layer to exist");

      layerModel.addDependencyToLayer(layer.id, "baseline", "^1.0.0");
      layerModel.addDependencyToLayer(layer.id, "extras", ">=2.0.0");

      const showResult = await runCli(["layer", "show", "team-stack@1.2.0"]);
      expect(showResult.stdout).toContain("team-stack@1.2.0");
      expect(showResult.stdout).toContain("baseline");
      expect(showResult.stdout).toContain("^1.0.0");
      expect(showResult.stdout).toContain("extras");
      expect(showResult.stdout).toContain(">=2.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("layer show prompts for layer name when omitted on TTY", async () => {
    const context = await createTestContext("cli-layer-show-prompt");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "team-stack", "--version", "1.2.0"]);
      await runCli(["layer", "create", "baseline", "--version", "1.0.0"]);

      const result = await runCli(["layer", "show"], {
        isTTY: true,
        promptResponses: [{ value: "team-stack@1.2.0" }],
      });

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("team-stack@1.2.0");
    } finally {
      await context.cleanup();
    }
  });

  it("layer show fails without prompt when name is omitted in non-interactive mode", async () => {
    const context = await createTestContext("cli-layer-show-no-prompt");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "team-stack"]);

      const result = await runCli(["layer", "show"], {
        isTTY: false,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing required argument 'name'");
    } finally {
      await context.cleanup();
    }
  });


  it("layer attach/detach --type layer-dependency manage dependencies via CLI", async () => {
    const context = await createTestContext("cli-layer-dependency");
    try {
      await runCli(["init"]);
      const layerModel = await import("../../src/models/layer.ts");

      await runCli(["layer", "create", "team-stack", "--version", "1.2.0"]);

      await runCli([
        "layer", "attach",
        "team-stack@1.2.0",
        "baseline",
        "--type", "layer-dependency",
        "--version", "^1.0.0",
      ]);

      const layer = layerModel.getLayer("team-stack@1.2.0");
      if (!layer) throw new Error("Expected layer to exist");

      const deps = layerModel.listLayerDependencies(layer.id);
      expect(deps).toHaveLength(1);
      expect(deps[0].dependency_name).toBe("baseline");
      expect(deps[0].version_constraint).toBe("^1.0.0");

      await runCli([
        "layer",
        "detach",
        "team-stack@1.2.0",
        "baseline",
        "--type",
        "layer-dependency",
      ]);

      const afterRemove = layerModel.listLayerDependencies(layer.id);
      expect(afterRemove).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("layer attach --type layer-dependency reports error for invalid layer selector instead of crashing", async () => {
    const context = await createTestContext("cli-layer-dep-invalid-selector");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "layer", "attach",
        "team-stack@not-semver",
        "baseline",
        "--type", "layer-dependency",
        "--version", "^1.0.0",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/invalid version constraint/i);
      expect(result.stderr).not.toMatch(/layer not found/i);
      expect(result.stdout).not.toContain("Added dependency");
    } finally {
      await context.cleanup();
    }
  });

  it("layer attach --type layer-dependency sets a failing exit code when the layer is missing", async () => {
    const context = await createTestContext("cli-layer-dep-missing-layer");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "layer",
        "attach",
        "missing-layer",
        "baseline",
        "--type",
        "layer-dependency",
        "--version",
        "^1.0.0",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/layer not found: missing-layer/i);
      expect(result.stdout).not.toContain("Added dependency");
    } finally {
      await context.cleanup();
    }
  });

  it("layer attach --type layer-dependency sets a failing exit code for an invalid version constraint", async () => {
    const context = await createTestContext("cli-layer-dep-invalid-version");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "team-stack", "--version", "1.2.0"]);

      const result = await runCli([
        "layer",
        "attach",
        "team-stack@1.2.0",
        "baseline",
        "--type",
        "layer-dependency",
        "--version",
        "not-semver",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/invalid version constraint/i);
    } finally {
      await context.cleanup();
    }
  });

  it("layer detach --type layer-dependency sets a failing exit code when the layer is missing", async () => {
    const context = await createTestContext("cli-layer-remove-dep-missing-layer");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "layer",
        "detach",
        "missing-layer",
        "baseline",
        "--type",
        "layer-dependency",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/layer not found: missing-layer/i);
    } finally {
      await context.cleanup();
    }
  });

  it("layer detach --type layer-dependency sets a failing exit code when the dependency is missing", async () => {
    const context = await createTestContext("cli-layer-remove-dep-missing-dependency");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "team-stack", "--version", "1.2.0"]);

      const result = await runCli([
        "layer",
        "detach",
        "team-stack@1.2.0",
        "baseline",
        "--type",
        "layer-dependency",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/dependency "baseline" not found/i);
    } finally {
      await context.cleanup();
    }
  });

  it("layer delete reports invalid selectors and exits with failure", async () => {
    const context = await createTestContext("cli-layer-delete-invalid-selector");
    try {
      await runCli(["init"]);

      const result = await runCli(["layer", "delete", "tool@not-semver"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/invalid version constraint/i);
      expect(result.stderr).not.toMatch(/layer not found/i);
    } finally {
      await context.cleanup();
    }
  });

  it("layer delete sets a failing exit code when the layer is missing", async () => {
    const context = await createTestContext("cli-layer-delete-missing");
    try {
      await runCli(["init"]);

      const result = await runCli(["layer", "delete", "missing-layer"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/layer not found: missing-layer/i);
    } finally {
      await context.cleanup();
    }
  });

  it("layer delete accepts a versioned selector and deletes only that version", async () => {
    const context = await createTestContext("cli-layer-delete-version-selector");
    try {
      await runCli(["init"]);
      const layerModel = await import("../../src/models/layer.ts");

      await runCli(["layer", "create", "tool", "--version", "1.0.0"]);
      await runCli(["layer", "create", "tool", "--version", "2.0.0"]);

      const result = await runCli(["layer", "delete", "tool@1.0.0"]);

      expect(result.exitCode ?? 0).toBe(0);
      expect(layerModel.getLayer("tool@1.0.0")).toBeUndefined();
      expect(layerModel.getLayer("tool@2.0.0")?.version).toBe("2.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("layer delete by plain name reports the deleted latest version", async () => {
    const context = await createTestContext("cli-layer-delete-latest-version");
    try {
      await runCli(["init"]);
      const layerModel = await import("../../src/models/layer.ts");

      await runCli(["layer", "create", "tool", "--version", "1.0.0"]);
      await runCli(["layer", "create", "tool", "--version", "2.0.0"]);

      const result = await runCli(["layer", "delete", "tool"]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain("tool@2.0.0");
      expect(layerModel.getLayer("tool@2.0.0")).toBeUndefined();
      expect(layerModel.getLayer("tool@1.0.0")?.version).toBe("1.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("creates, shows, associates, removes, and deletes layers", async () => {
    const context = await createTestContext("cli-layer");

    try {
      await runCli(["init"]);

      const layerModel = await import("../../src/models/layer.ts");
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
        "layer",
        "create",
        "team",
        "--description",
        "Team layer",
        "--tags",
        "core,shared",
      ]);
      expect(createResult.stdout).toContain("✓ Created layer");
      expect(createResult.stdout).toContain("team");

      const createList = await runCli(["layer", "list"]);
      expect(createList.stdout).toContain("team");

      const addResult = await runCli([
        "layer",
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

      const layerShow = await runCli(["layer", "show", "team"]);
      expect(layerShow.stdout).toContain("team");
      expect(layerShow.stdout).toContain("shared-skill");

      const removeResult = await runCli([
        "layer",
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

      const teamLayer = layerModel.getLayer("team");
      expect(teamLayer).toBeDefined();
      if (!teamLayer) {
        throw new Error("Expected the team layer to exist after creation");
      }

      expect(layerModel.getLayerResources(teamLayer.id)).toHaveLength(0);

      const deleteResult = await runCli(["layer", "delete", "team"]);
      expect(deleteResult.stdout).toContain("✓ Deleted layer");
      expect(deleteResult.stdout).toContain("team");

      expect(layerModel.getLayer("team")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("layer show hides resource IDs by default and reveals them with --show-id", async () => {
    const context = await createTestContext("cli-layer-show-ids");
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

      await runCli(["layer", "create", "team"]);
      await runCli(["layer", "attach", "team", resource.id, "--type", "skill"]);
      const shortId = `${resource.id.slice(0, 6)}…${resource.id.slice(-4)}`;

      const hidden = await runCli(["layer", "show", "team"]);
      const shown = await runCli(["layer", "show", "team", "--show-id"]);

      expect(hidden.stdout).toContain("RESOURCES");
      expect(hidden.stdout).not.toMatch(/\|\s+ID\s+\|/);
      expect(hidden.stdout).not.toContain(shortId);
      expect(shown.stdout).toMatch(/\|\s+ID\s+\|/);
      expect(shown.stdout).toContain(shortId);
    } finally {
      await context.cleanup();
    }
  });

  it("renders layer list as a shared table with a summary footer", async () => {
    const context = await createTestContext("cli-layer-list-table");
    try {
      await runCli(["init"]);
      const result = await runCli(["layer", "list"], { commandName: "hd" });
      expect(result.stdout).toContain("NAME");
      expect(result.stdout).toContain("DESCRIPTION");
      expect(result.stdout).toContain("run `hd layer show <name>` for details");
    } finally {
      await context.cleanup();
    }
  });

  it("renders layer show as a detail panel with a resource sub-table", async () => {
    const context = await createTestContext("cli-layer-show-panel");
    try {
      await runCli(["init"]);
      const result = await runCli(["layer", "show", "nextjs-fullstack"]);
      expect(result.stdout).toContain("LAYER");
      expect(result.stdout).toContain("Description");
      expect(result.stdout).toContain("RESOURCES");
    } finally {
      await context.cleanup();
    }
  });

  it("renders layer diff as a compact diff table with a summary footer", async () => {
    const context = await createTestContext("cli-layer-diff-ui");
    try {
      await runCli(["init"]);
      const result = await runCli(["layer", "diff", "nextjs-fullstack", "python-fastapi"]);
      expect(result.stdout).toContain("DIFF");
      expect(result.stdout).toContain("~");
    } finally {
      await context.cleanup();
    }
  });

  it("runs layer doctor and shows all checks with pass markers for healthy layer", async () => {
    const context = await createTestContext("cli-layer-doctor-ui");
    try {
      await runCli(["init"]);
      const layerModel = await import("../../src/models/layer.ts");
      layerModel.createLayer({ name: "healthy-layer" });

      const result = await runCli(["layer", "doctor", "healthy-layer"]);
      expect(result.stdout).toContain("CHECK");
      expect(result.stdout).toContain("RESULT");
      expect(result.stdout).toContain("✓"); // pass marker
      expect(result.stdout).toContain("empty-layer");
      expect(result.stdout).toContain("duplicate-resources");
      expect(result.stdout).toContain("empty-content");
      expect(result.stdout).toContain("plugin-metadata");
      expect(result.exitCode).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("reports plugin-metadata errors with fail markers and exits with failure", async () => {
    const context = await createTestContext("cli-layer-doctor-plugin-metadata");
    try {
      await runCli(["init"]);
      const layerModel = await import("../../src/models/layer.ts");
      const pluginModel = await import("../../src/models/plugin.ts");
      const layer = layerModel.createLayer({ name: "bad-plugin-meta" });
      pluginModel.addPluginToLayer(layer.id, "formatter", "not-semver");

      const result = await runCli([
        "layer",
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

  it("lists doctor checks without requiring a layer", async () => {
    const context = await createTestContext("cli-layer-doctor-list-checks");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "layer",
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

  it("narrows layer doctor to the selected checks", async () => {
    const context = await createTestContext("cli-layer-doctor-check-filter");
    try {
      await runCli(["init"]);
      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const layer = layerModel.createLayer({ name: "doctor-filter" });
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
      layerModel.addResourceToLayer(layer.id, duplicateResourceA.id);
      layerModel.addResourceToLayer(layer.id, duplicateResourceB.id);
      layerModel.addResourceToLayer(layer.id, emptyResource.id);

      const result = await runCli([
        "layer",
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

  it("rejects the removed layer validate command", async () => {
    await expect(runCli(["layer", "validate", "empty-layer"])).rejects.toMatchObject({
      code: "commander.unknownCommand",
      exitCode: 1,
      message: expect.stringMatching(/unknown command/i),
    } satisfies Partial<CommanderError>);
  });

  it("accepts resource names when adding and removing typed layer resources", async () => {
    const context = await createTestContext("cli-layer-resource-selector");
    try {
      await runCli(["init"]);
      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const layer = layerModel.createLayer({ name: "team" });
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );

      await runCli(["layer", "attach", "team", "shared-skill", "--type", "skill"]);
      expect(layerModel.getLayerResources(layer.id)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: resource.id })]),
      );

      await runCli(["layer", "detach", "team", "shared-skill", "--type", "skill"]);
      expect(layerModel.getLayerResources(layer.id)).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("shows candidate details for ambiguous typed layer attach resource matches", async () => {
    const context = await createTestContext("cli-layer-add-ambiguous-resource");
    try {
      await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");
      const first = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared A" }),
      );
      const second = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared B" }),
      );
      await runCli(["layer", "create", "team"]);

      const result = await runCli([
        "layer",
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

  it("shows candidate details for ambiguous typed layer detach resource matches", async () => {
    const context = await createTestContext("cli-layer-remove-ambiguous-resource");
    try {
      await runCli(["init"]);
      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const layer = layerModel.createLayer({ name: "team" });
      const first = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared A" }),
      );
      const second = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared B" }),
      );
      layerModel.addResourceToLayer(layer.id, first.id);
      layerModel.addResourceToLayer(layer.id, second.id);

      const result = await runCli([
        "layer",
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

  it("requires --type for layer attach", async () => {
    const context = await createTestContext("cli-layer-add-type-required");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "team"]);

      const result = await runCli(["layer", "attach", "team", "shared-skill"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--type is required");
      expect(result.stderr).toContain("instruction");
      expect(result.stderr).toContain("plugin");
      expect(result.stderr).toContain("layer-dependency");
    } finally {
      await context.cleanup();
    }
  });

  it("auto-prompts layer attach on a TTY when required args are missing", async () => {
    const context = await createTestContext("cli-layer-add-wizard");
    try {
      await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );
      await runCli(["layer", "create", "team"]);

      const result = await runCli(["layer", "attach", "team"], {
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

  it("auto-prompts layer attach for the layer when the layer name is missing", async () => {
    const context = await createTestContext("cli-layer-add-missing-layer");
    try {
      await runCli(["init"]);
      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const layer = layerModel.createLayer({ name: "team" });
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );

      const result = await runCli(["layer", "attach"], {
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
      expect(layerModel.getLayerResources(layer.id)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: resource.id })]),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("does not auto-prompt layer attach when --format json is requested", async () => {
    const context = await createTestContext("cli-layer-add-wizard-json");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "team"]);

      const result = await runCli(["layer", "attach", "team", "--format", "json"], {
        isTTY: true,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing required argument 'selector'");
    } finally {
      await context.cleanup();
    }
  });

  it("does not auto-prompt layer attach when CI disables interactivity", async () => {
    const context = await createTestContext("cli-layer-add-wizard-ci");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "team"]);

      const result = await runCli(["layer", "attach", "team"], {
        isTTY: true,
        env: { CI: "true" },
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing required argument 'selector'");
    } finally {
      await context.cleanup();
    }
  });

  it("does not auto-prompt layer attach when --no-interactive is requested", async () => {
    const context = await createTestContext("cli-layer-add-wizard-disabled");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "team"]);

      const result = await runCli(["--no-interactive", "layer", "attach", "team"], {
        isTTY: true,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing required argument 'selector'");
    } finally {
      await context.cleanup();
    }
  });

  it("requires --type for layer detach", async () => {
    const context = await createTestContext("cli-layer-remove-type-required");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "team"]);

      const result = await runCli(["layer", "detach", "team", "shared-skill"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--type is required");
      expect(result.stderr).toContain("instruction");
      expect(result.stderr).toContain("plugin");
      expect(result.stderr).toContain("layer-dependency");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects invalid --type for layer detach", async () => {
    const context = await createTestContext("cli-layer-remove-type-invalid");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "team"]);

      const result = await runCli([
        "layer",
        "detach",
        "team",
        "shared-skill",
        "--type",
        "not-a-real-type",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid --type. Valid:");
      expect(result.stderr).toContain("plugin");
      expect(result.stderr).toContain("layer-dependency");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects mismatched resource type selectors", async () => {
    const context = await createTestContext("cli-layer-add-resource-type-mismatch");
    try {
      await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");
      resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );
      await runCli(["layer", "create", "team"]);

      const result = await runCli([
        "layer",
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
    const context = await createTestContext("cli-layer-add-resource-invalid-flags");
    try {
      await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");
      resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );
      await runCli(["layer", "create", "team"]);

      const versionResult = await runCli([
        "layer",
        "attach",
        "team",
        "shared-skill",
        "--type",
        "skill",
        "--version",
        "^1.0.0",
      ]);
      expect(versionResult.exitCode).toBe(1);
      expect(versionResult.stderr).toContain("--version is only supported for --type plugin and --type layer-dependency");

      const embedResult = await runCli([
        "layer",
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

  it("rejects --embed for layer dependencies", async () => {
    const context = await createTestContext("cli-layer-dependency-embed-invalid");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "team-stack", "--version", "1.2.0"]);

      const result = await runCli([
        "layer",
        "attach",
        "team-stack@1.2.0",
        "baseline",
        "--type",
        "layer-dependency",
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

  it("adds and removes plugin pins with typed verdicts", async () => {
    const context = await createTestContext("cli-layer-plugin-verdicts");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "plugin-test"]);

      const addResult = await runCli([
        "layer",
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
        "layer",
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
