import { describe, expect, it, spyOn } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import * as tableBrowserPrompt from "../../src/services/wizards/prompts/create-table-browser-prompt.ts";
import * as interactiveResourceList from "../../src/services/wizards/interactive-resource-list.ts";

describe("wizard prompts", () => {
  it("uses the table browser when deleting plugins interactively", async () => {
    const context = await createInitializedTestContext("wizard-plugin-delete-prompts");
    const promptSpy = spyOn(tableBrowserPrompt, "createTableBrowserPrompt").mockResolvedValue({
      kind: "pick-one",
      value: "team@1.0.0",
    });

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      pluginModel.createPlugin({ name: "team" });
      pluginModel.createPlugin({ name: "baseline", version: "2.0.0" });

      const { runPluginDeleteWizard } = await import("../../src/services/wizards/plugin-delete.ts");
      const result = await runPluginDeleteWizard();

      expect(result).toEqual(["team@1.0.0"]);
      expect(promptSpy).toHaveBeenCalled();
    } finally {
      promptSpy.mockRestore();
      await context.cleanup();
    }
  });

  it("shows namespace in resource delete choice labels when present", async () => {
    const context = await createInitializedTestContext("wizard-resource-delete-namespace");
    const promptSpy = spyOn(tableBrowserPrompt, "createTableBrowserPrompt").mockResolvedValue({
      kind: "cancel",
    });

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

      expect(promptSpy).toHaveBeenCalled();
    } finally {
      promptSpy.mockRestore();
      await context.cleanup();
    }
  });

  it("uses the table browser when deleting resources interactively", async () => {
    const context = await createInitializedTestContext("wizard-resource-delete-prompts");
    const promptSpy = spyOn(tableBrowserPrompt, "createTableBrowserPrompt");

    try {
      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );
      promptSpy.mockResolvedValue({
        kind: "pick-one",
        value: resource.id,
      });

      const { runResourceDeleteWizard } = await import("../../src/services/wizards/resource-delete.ts");
      const result = await runResourceDeleteWizard();

      expect(result).toEqual([resource.id]);
      expect(promptSpy).toHaveBeenCalled();
    } finally {
      promptSpy.mockRestore();
      await context.cleanup();
    }
  });

  it("uses an interactive resource list prompt with live tables when listing resources", async () => {
    const context = await createInitializedTestContext("wizard-resource-list-prompts");
    const listSpy = spyOn(interactiveResourceList, "promptForInteractiveResourceList").mockResolvedValue({
      action: "filter",
      query: "shared",
    });

    try {
      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );

      const { runResourceListWizard } = await import("../../src/services/wizards/resource-list.ts");
      const result = await runResourceListWizard();

      expect(result).toEqual({ action: "filter", query: "shared" });
      expect(listSpy).toHaveBeenCalledWith(
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
      listSpy.mockRestore();
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
