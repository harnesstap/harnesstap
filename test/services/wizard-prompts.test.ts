import { describe, expect, it, mock, spyOn } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";

const searchableMultiSelectMock = mock(() => Promise.resolve([] as string[]));
const interactiveResourceListMock = mock(() => Promise.resolve({ action: "filter", query: "" }));
const resourceDeleteWizardMock = mock(() => Promise.resolve([] as string[]));
const layerDeleteWizardMock = mock(() => Promise.resolve([] as string[]));

mock.module("../../src/services/wizards/searchable-multi-select.js", () => ({
  promptForSearchableMultiSelect: searchableMultiSelectMock,
}));

mock.module("../../src/services/wizards/interactive-resource-list.js", () => ({
  promptForInteractiveResourceList: interactiveResourceListMock,
}));

mock.module("../../src/services/wizards/resource-delete.js", () => ({
  runResourceDeleteWizard: resourceDeleteWizardMock,
}));

mock.module("../../src/services/wizards/layer-delete.js", () => ({
  runLayerDeleteWizard: layerDeleteWizardMock,
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
  it("uses the table browser when deleting layers interactively", async () => {
    const context = await createInitializedTestContext("wizard-layer-delete-prompts");
    layerDeleteWizardMock.mockReset();
    layerDeleteWizardMock.mockResolvedValueOnce(["team@1.0.0"]);

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      layerModel.createLayer({ name: "team" });
      layerModel.createLayer({ name: "baseline", version: "2.0.0" });

      const { runLayerDeleteWizard } = await import("../../src/services/wizards/layer-delete.ts");
      const result = await runLayerDeleteWizard();

      expect(result).toEqual(["team@1.0.0"]);
      expect(layerDeleteWizardMock).toHaveBeenCalled();
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

  it("uses a searchable choice prompt when layer apply needs a layer choice", async () => {
    const context = await createInitializedTestContext("wizard-layer-apply-prompts");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      layerModel.createLayer({ name: "apply-layer" });

      const shared = await import("../../src/services/wizards/shared.ts");
      const choiceSpy = spyOn(shared, "promptForSearchableChoice").mockResolvedValue(
        "apply-layer@1.0.0",
      );

      try {
        const { runLayerApplyWizard } = await import("../../src/services/wizards/layer-apply.ts");
        const result = await runLayerApplyWizard();

        expect(result).toBe("apply-layer@1.0.0");
        expect(choiceSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            message: "Which layer should be applied?",
            choices: [
              {
                name: "apply-layer@1.0.0",
                value: "apply-layer@1.0.0",
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
