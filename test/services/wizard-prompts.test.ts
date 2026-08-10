import { describe, expect, it, mock, spyOn } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";

const searchableMultiSelectMock = mock(() => Promise.resolve([] as string[]));
const interactiveResourceListMock = mock(() => Promise.resolve({ action: "filter", query: "" }));
const resourceDeleteWizardMock = mock(() => Promise.resolve([] as string[]));
const pluginDeleteWizardMock = mock(() => Promise.resolve([] as string[]));

mock.module("../../src/services/wizards/searchable-multi-select.js", () => ({
  promptForSearchableMultiSelect: searchableMultiSelectMock,
}));

mock.module("../../src/services/wizards/interactive-resource-list.js", () => ({
  promptForInteractiveResourceList: interactiveResourceListMock,
}));

mock.module("../../src/services/wizards/resource-delete.js", () => ({
  runResourceDeleteWizard: resourceDeleteWizardMock,
}));

mock.module("../../src/services/wizards/plugin-delete.js", () => ({
  runPluginDeleteWizard: pluginDeleteWizardMock,
}));

interface CapturedPrompt {
  type?: unknown;
  message?: unknown;
  choices?: unknown;
}

function _firstPrompt(input: unknown): CapturedPrompt {
  if (!Array.isArray(input)) {
    return input as CapturedPrompt;
  }
  return (input[0] ?? {}) as CapturedPrompt;
}

describe("wizard prompts", () => {
  it("uses the table browser when deleting plugins interactively", async () => {
    const context = await createInitializedTestContext("wizard-plugin-delete-prompts");
    pluginDeleteWizardMock.mockReset();
    pluginDeleteWizardMock.mockResolvedValueOnce(["team@1.0.0"]);

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      pluginModel.createPlugin({ name: "team" });
      pluginModel.createPlugin({ name: "baseline", version: "2.0.0" });

      const { runPluginDeleteWizard } = await import("../../src/services/wizards/plugin-delete.ts");
      const result = await runPluginDeleteWizard();

      expect(result).toEqual(["team@1.0.0"]);
      expect(pluginDeleteWizardMock).toHaveBeenCalled();
    } finally {
      await context.cleanup();
    }
  });

  it("shows namespace in resource delete choice labels when present", async () => {
    const context = await createInitializedTestContext("wizard-resource-delete-namespace");
    resourceDeleteWizardMock.mockReset();
    resourceDeleteWizardMock.mockResolvedValueOnce([]);

    try {
      const resourceModel = await import("../../src/models/resource.ts");
      resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "brainstorming",
          namespace: "cursor-team-kit",
          content: "# Brainstorming",
        }),
      );

      const { runResourceDeleteWizard } = await import("../../src/services/wizards/resource-delete.ts");
      await runResourceDeleteWizard();

      expect(resourceDeleteWizardMock).toHaveBeenCalled();
    } finally {
      await context.cleanup();
    }
  });

  it("uses the table browser when deleting resources interactively", async () => {
    const context = await createInitializedTestContext("wizard-resource-delete-prompts");
    resourceDeleteWizardMock.mockReset();
    let selectedResourceId = "";

    try {
      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );
      selectedResourceId = resource.id;
      resourceDeleteWizardMock.mockResolvedValueOnce([selectedResourceId]);

      const { runResourceDeleteWizard } = await import("../../src/services/wizards/resource-delete.ts");
      const result = await runResourceDeleteWizard();

      expect(result).toEqual([resource.id]);
      expect(resourceDeleteWizardMock).toHaveBeenCalled();
    } finally {
      await context.cleanup();
    }
  });

  it("uses an interactive resource list prompt with live tables when listing resources", async () => {
    const context = await createInitializedTestContext("wizard-resource-list-prompts");
    interactiveResourceListMock.mockReset();
    interactiveResourceListMock.mockResolvedValueOnce({ action: "filter", query: "shared" });

    try {
      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );

      const { runResourceListWizard } = await import("../../src/services/wizards/resource-list.ts");
      const result = await runResourceListWizard();

      expect(result).toEqual({ action: "filter", query: "shared" });
      expect(interactiveResourceListMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Filter resources",
          resources: [
            expect.objectContaining({
              id: resource.id,
              type: "skill",
              display_name: "shared-skill",
            }),
          ],
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("uses a searchable choice prompt when plugin apply needs a plugin choice", async () => {
    const context = await createInitializedTestContext("wizard-plugin-apply-prompts");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      pluginModel.createPlugin({ name: "apply-plugin" });

      const shared = await import("../../src/services/wizards/shared.ts");
      const choiceSpy = spyOn(shared, "promptForSearchableChoice").mockResolvedValue(
        "apply-plugin@1.0.0",
      );

      try {
        const { runPluginApplyWizard } = await import("../../src/services/wizards/plugin-apply.ts");
        const result = await runPluginApplyWizard();

        expect(result).toBe("apply-plugin@1.0.0");
        expect(choiceSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            message: "Which plugin should be applied?",
            choices: [
              {
                name: "apply-plugin@1.0.0",
                value: "apply-plugin@1.0.0",
                description: undefined,
              },
            ],
          }),
        );
      } finally {
        choiceSpy.mockRestore();
      }
    } finally {
      await context.cleanup();
    }
  });
});
