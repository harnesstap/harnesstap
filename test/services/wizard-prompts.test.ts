import { describe, expect, it, mock, spyOn } from "bun:test";
import inquirer from "inquirer";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";

const searchableMultiSelectMock = mock(() => Promise.resolve([] as string[]));

mock.module("../../src/services/wizards/searchable-multi-select.js", () => ({
  promptForSearchableMultiSelect: searchableMultiSelectMock,
}));

interface CapturedPrompt {
  type?: unknown;
  message?: unknown;
  choices?: unknown;
}

function firstPrompt(input: unknown): CapturedPrompt {
  if (!Array.isArray(input)) {
    return input as CapturedPrompt;
  }
  return (input[0] ?? {}) as CapturedPrompt;
}

describe("wizard prompts", () => {
  it("uses list prompts for layer add resource flows", async () => {
    const context = await createInitializedTestContext("wizard-layer-add-prompts");
    const promptCalls: CapturedPrompt[] = [];
    let selectedResourceId = "";
    const promptSpy = spyOn(inquirer, "prompt").mockImplementation(
      async (questions) => {
        const prompt = firstPrompt(questions);
        promptCalls.push(prompt);

        if (promptCalls.length === 1) {
          return { value: "resource" };
        }
        if (promptCalls.length === 2) {
          return { value: "skill" };
        }
        return { value: selectedResourceId };
      },
    );

    try {
      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );
      selectedResourceId = resource.id;

      const { runLayerAddWizard } = await import("../../src/services/wizards/layer-add.ts");
      const result = await runLayerAddWizard({ shouldPrompt: true });

      expect(result).toEqual({
        type: "skill",
        selector: resource.id,
        version: undefined,
      });
      expect(promptCalls).toHaveLength(3);
      expect(promptCalls[0]?.type).toBe("list");
      expect(promptCalls[1]?.type).toBe("list");
      expect(promptCalls[2]?.type).toBe("list");
      expect(promptCalls[2]?.message).toBe("Which skill should be attached?");
      expect(promptCalls[2]?.choices).toEqual([
        {
          name: "shared-skill",
          value: resource.id,
        },
      ]);
    } finally {
      promptSpy.mockRestore();
      await context.cleanup();
    }
  });

  it("prompts for plugin selector, version, and embed confirmation", async () => {
    const context = await createInitializedTestContext("wizard-layer-add-plugin-prompts");
    const promptCalls: CapturedPrompt[] = [];
    const promptSpy = spyOn(inquirer, "prompt").mockImplementation(
      async (questions) => {
        const prompt = firstPrompt(questions);
        promptCalls.push(prompt);

        if (promptCalls.length === 1) {
          return { value: "plugin" };
        }
        if (promptCalls.length === 2) {
          return { value: "formatter@marketplace" };
        }
        if (promptCalls.length === 3) {
          return { value: "^1.0.0" };
        }
        return { value: true };
      },
    );

    try {
      const { runLayerAddWizard } = await import("../../src/services/wizards/layer-add.ts");
      const result = await runLayerAddWizard({ shouldPrompt: true });

      expect(result).toEqual({
        type: "plugin",
        selector: "formatter@marketplace",
        version: "^1.0.0",
        embed: true,
      });
      expect(promptCalls.map((prompt) => prompt.type)).toEqual([
        "list",
        "input",
        "input",
        "confirm",
      ]);
    } finally {
      promptSpy.mockRestore();
      await context.cleanup();
    }
  });

  it("uses a searchable multi-select prompt when deleting layers interactively", async () => {
    const context = await createInitializedTestContext("wizard-layer-delete-prompts");
    searchableMultiSelectMock.mockReset();
    searchableMultiSelectMock.mockResolvedValueOnce(["team@1.0.0", "baseline@2.0.0"]);

    try {
      const layerModel = await import("../../src/models/layer.ts");
      layerModel.createLayer({ name: "team" });
      layerModel.createLayer({ name: "baseline", version: "2.0.0" });

      const { runLayerDeleteWizard } = await import("../../src/services/wizards/layer-delete.ts");
      const result = await runLayerDeleteWizard();

      expect(result).toEqual(["team@1.0.0", "baseline@2.0.0"]);
      expect(searchableMultiSelectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Which layers do you want to delete?",
          choices: expect.arrayContaining([
            { name: "team@1.0.0", value: "team@1.0.0", description: "" },
            { name: "baseline@2.0.0", value: "baseline@2.0.0", description: "" },
          ]),
          pageSize: 10,
          loop: false,
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("shows namespace in resource delete choice labels when present", async () => {
    const context = await createInitializedTestContext("wizard-resource-delete-namespace");
    searchableMultiSelectMock.mockReset();
    searchableMultiSelectMock.mockResolvedValueOnce([]);

    try {
      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "brainstorming",
          namespace: "cursor-team-kit",
          content: "# Brainstorming",
        }),
      );

      const { runResourceDeleteWizard } = await import("../../src/services/wizards/resource-delete.ts");
      await runResourceDeleteWizard();

      expect(searchableMultiSelectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          choices: [
            {
              name: "skill brainstorming@cursor-team-kit",
              value: resource.id,
              description: resource.description,
            },
          ],
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("uses a searchable multi-select prompt when deleting resources interactively", async () => {
    const context = await createInitializedTestContext("wizard-resource-delete-prompts");
    searchableMultiSelectMock.mockReset();
    let selectedResourceId = "";

    try {
      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );
      selectedResourceId = resource.id;
      searchableMultiSelectMock.mockResolvedValueOnce([selectedResourceId]);

      const { runResourceDeleteWizard } = await import("../../src/services/wizards/resource-delete.ts");
      const result = await runResourceDeleteWizard();

      expect(result).toEqual([resource.id]);
      expect(searchableMultiSelectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Which resources do you want to delete?",
          choices: [
            {
              name: "skill shared-skill",
              value: resource.id,
              description: resource.description,
            },
          ],
          pageSize: 10,
          loop: false,
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("uses a list prompt when project apply needs a layer choice", async () => {
    const context = await createInitializedTestContext("wizard-project-apply-prompts");
    const promptCalls: CapturedPrompt[] = [];
    const promptSpy = spyOn(inquirer, "prompt").mockImplementation(async (questions) => {
      promptCalls.push(firstPrompt(questions));
      return { value: "apply-layer" };
    });

    try {
      const layerModel = await import("../../src/models/layer.ts");
      layerModel.createLayer({ name: "apply-layer" });

      const { runProjectApplyWizard } = await import("../../src/services/wizards/project-apply.ts");
      const result = await runProjectApplyWizard();

      expect(result).toBe("apply-layer");
      expect(promptCalls[0]?.type).toBe("list");
    } finally {
      promptSpy.mockRestore();
      await context.cleanup();
    }
  });
});
