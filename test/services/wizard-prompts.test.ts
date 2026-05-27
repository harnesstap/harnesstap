import { describe, expect, it, spyOn } from "bun:test";
import inquirer from "inquirer";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";

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
  it("uses list prompts for preset add resource flows", async () => {
    const context = await createInitializedTestContext("wizard-preset-add-prompts");
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

      const { runPresetAddWizard } = await import("../../src/services/wizards/preset-add.ts");
      const result = await runPresetAddWizard({ shouldPrompt: true });

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
    const context = await createInitializedTestContext("wizard-preset-add-plugin-prompts");
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
      const { runPresetAddWizard } = await import("../../src/services/wizards/preset-add.ts");
      const result = await runPresetAddWizard({ shouldPrompt: true });

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

  it("uses a list prompt when deleting presets interactively", async () => {
    const context = await createInitializedTestContext("wizard-preset-delete-prompts");
    const promptCalls: CapturedPrompt[] = [];
    const promptSpy = spyOn(inquirer, "prompt").mockImplementation(async (questions) => {
      promptCalls.push(firstPrompt(questions));
      return { value: "team@1.0.0" };
    });

    try {
      const presetModel = await import("../../src/models/preset.ts");
      presetModel.createPreset({ name: "team" });

      const { runPresetDeleteWizard } = await import("../../src/services/wizards/preset-delete.ts");
      const result = await runPresetDeleteWizard();

      expect(result).toBe("team@1.0.0");
      expect(promptCalls[0]?.type).toBe("list");
    } finally {
      promptSpy.mockRestore();
      await context.cleanup();
    }
  });

  it("uses a list prompt when deleting resources interactively", async () => {
    const context = await createInitializedTestContext("wizard-resource-delete-prompts");
    const promptCalls: CapturedPrompt[] = [];
    let selectedResourceId = "";
    const promptSpy = spyOn(inquirer, "prompt").mockImplementation(async (questions) => {
      promptCalls.push(firstPrompt(questions));
      return { value: selectedResourceId };
    });

    try {
      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );
      selectedResourceId = resource.id;

      const { runResourceDeleteWizard } = await import("../../src/services/wizards/resource-delete.ts");
      const result = await runResourceDeleteWizard();

      expect(result).toBe(resource.id);
      expect(promptCalls[0]?.type).toBe("list");
    } finally {
      promptSpy.mockRestore();
      await context.cleanup();
    }
  });

  it("uses a list prompt when project apply needs a preset choice", async () => {
    const context = await createInitializedTestContext("wizard-project-apply-prompts");
    const promptCalls: CapturedPrompt[] = [];
    const promptSpy = spyOn(inquirer, "prompt").mockImplementation(async (questions) => {
      promptCalls.push(firstPrompt(questions));
      return { value: "apply-preset" };
    });

    try {
      const presetModel = await import("../../src/models/preset.ts");
      presetModel.createPreset({ name: "apply-preset" });

      const { runProjectApplyWizard } = await import("../../src/services/wizards/project-apply.ts");
      const result = await runProjectApplyWizard();

      expect(result).toBe("apply-preset");
      expect(promptCalls[0]?.type).toBe("list");
    } finally {
      promptSpy.mockRestore();
      await context.cleanup();
    }
  });
});
