import { render } from "@inquirer/testing";
import { describe, expect } from "bun:test";
import { promptIt, withPrompt } from "../helpers/prompt-test.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import { listEnvironmentsCommand } from "../../src/services/environment-commands.ts";
import { createEnvironmentTableBrowserAdapter } from "../../src/services/wizards/adapters/environment-table-browser.ts";
import { createTableBrowserPrompt } from "../../src/services/wizards/prompts/create-table-browser-prompt.ts";
import type { EnvironmentListRow } from "../../src/ui/environment-list-render.ts";
import { runEnvironmentShowWizard } from "../../src/services/wizards/environment-show.ts?actual";

function renderEnvironmentPickPrompt(
  message: string,
  action: "show" | "delete",
  enterLabel: string,
  environments: EnvironmentListRow[],
  context?: Parameters<typeof createTableBrowserPrompt>[1],
) {
  return createTableBrowserPrompt<EnvironmentListRow, string>(
    {
      message,
      intent: { kind: "pick-one", action },
      adapter: {
        ...createEnvironmentTableBrowserAdapter({ environments }),
        onPick: (row) => row.environment.name,
        helpActions: [
          ["↑↓", "select"],
          ["type", "search"],
          ["⏎", enterLabel],
          ["esc", "cancel"],
        ],
      },
    },
    context,
  );
}

describe("environment delete wizard", () => {
  promptIt("returns the selected environment name on enter", async () => {
    const context = await createInitializedTestContext("environment-delete-wizard-pick");

    try {
      const environmentModel = await import("../../src/models/environment.ts");
      environmentModel.createEnvironment({ name: "staging" });
      environmentModel.createEnvironment({ name: "production" });

      const { answer, events } = await render(
        (_config, promptContext) =>
          renderEnvironmentPickPrompt(
            "Which environment do you want to delete?",
            "delete",
            "delete",
            listEnvironmentsCommand(),
            promptContext,
          ),
        undefined,
        { clearPromptOnDone: true },
      );

      events.type("prod");
      events.keypress("enter");

      await expect(answer).resolves.toEqual({ kind: "pick-one", value: "production" });
    } finally {
      await context.cleanup();
    }
  });

  promptIt("does not render Active or Show selection line in browse view", async () => {
    const context = await createInitializedTestContext("environment-delete-wizard-chrome");

    try {
      const environmentModel = await import("../../src/models/environment.ts");
      environmentModel.createEnvironment({ name: "staging" });
      environmentModel.createEnvironment({ name: "production" });

      await withPrompt(
        render(
          (_config, promptContext) =>
            renderEnvironmentPickPrompt(
              "Which environment do you want to delete?",
              "delete",
              "delete",
              listEnvironmentsCommand(),
              promptContext,
            ),
          undefined,
          { clearPromptOnDone: true },
        ),
        ({ getScreen }) => {
          const frame = getScreen();
          expect(frame).not.toMatch(/\nShow: /);
          expect(frame).not.toMatch(/\nActive: /);
          expect(frame).toMatch(/⏎.*delete/);
        },
      );
    } finally {
      await context.cleanup();
    }
  });
});

describe("environment show wizard", () => {
  promptIt("returns undefined when no environments exist", async () => {
    const context = await createInitializedTestContext("environment-show-wizard-empty");

    try {
      const result = await runEnvironmentShowWizard();
      expect(result).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  promptIt("picks an environment on enter", async () => {
    const context = await createInitializedTestContext("environment-show-wizard-pick");

    try {
      const environmentModel = await import("../../src/models/environment.ts");
      environmentModel.createEnvironment({ name: "staging" });
      environmentModel.createEnvironment({ name: "production" });

      const { answer, events } = await render(
        (_config, promptContext) =>
          renderEnvironmentPickPrompt(
            "Which environment do you want to show?",
            "show",
            "show",
            listEnvironmentsCommand(),
            promptContext,
          ),
        undefined,
        { clearPromptOnDone: true },
      );

      events.type("prod");
      events.keypress("enter");

      await expect(answer).resolves.toEqual({ kind: "pick-one", value: "production" });
    } finally {
      await context.cleanup();
    }
  });

  promptIt("does not render Active or Show selection line in browse view", async () => {
    const context = await createInitializedTestContext("environment-show-wizard-chrome");

    try {
      const environmentModel = await import("../../src/models/environment.ts");
      environmentModel.createEnvironment({ name: "staging" });
      environmentModel.createEnvironment({ name: "production" });

      await withPrompt(
        render(
          (_config, promptContext) =>
            renderEnvironmentPickPrompt(
              "Which environment do you want to show?",
              "show",
              "show",
              listEnvironmentsCommand(),
              promptContext,
            ),
          undefined,
          { clearPromptOnDone: true },
        ),
        ({ getScreen }) => {
          const frame = getScreen();
          expect(frame).not.toMatch(/\nShow: /);
          expect(frame).not.toMatch(/\nActive: /);
        },
      );
    } finally {
      await context.cleanup();
    }
  });
});
