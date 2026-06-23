import { render } from "@inquirer/testing";
import { describe, expect } from "bun:test";
import { promptIt, withPrompt } from "../helpers/prompt-test.ts";
import { promptForInteractiveEnvironmentList } from "../../src/services/wizards/interactive-environment-list.ts?actual";
import type { EnvironmentListRow } from "../../src/ui/environment-list-render.ts";

const CTRL_E = { name: "e", ctrl: true } as const;
const CTRL_X = { name: "x", ctrl: true } as const;

function makeRow(name: string, description = ""): EnvironmentListRow {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    environment: {
      id: `env-${name}`,
      name,
      description,
      created_at: now,
      updated_at: now,
    },
    value_count: 1,
    secret_ref_count: 0,
    reference_count: 0,
  };
}

const sampleEnvironments = [
  makeRow("production", "Production deployment"),
  makeRow("staging", "Staging deployment"),
];

describe("interactive environment list prompt", () => {
  promptIt("filters the table as you type and exits with the query on esc", async () => {
    const { answer, events } = await render(
      promptForInteractiveEnvironmentList,
      {
        message: "Filter environments",
        environments: sampleEnvironments,
      },
      { clearPromptOnDone: true },
    );

    events.type("prod");
    events.keypress("escape");

    await expect(answer).resolves.toEqual({ action: "filter", query: "prod" });
  });

  promptIt("shows an environment on enter and returns to browse on esc", async () => {
    const { answer, events } = await render(
      promptForInteractiveEnvironmentList,
      {
        message: "Filter environments",
        environments: sampleEnvironments,
      },
      { clearPromptOnDone: true },
    );

    events.type("prod");
    events.keypress("enter");
    events.keypress("escape");
    events.keypress("escape");

    await expect(answer).resolves.toEqual({ action: "filter", query: "prod" });
  });

  promptIt("does not render Active or Show selection line in browse view", async () => {
    await withPrompt(
      render(
        promptForInteractiveEnvironmentList,
        {
          message: "Filter environments",
          environments: sampleEnvironments,
        },
        { clearPromptOnDone: true },
      ),
      ({ getScreen }) => {
        const frame = getScreen();
        expect(frame).not.toMatch(/\nShow: /);
        expect(frame).not.toMatch(/\nActive: /);
        expect(frame).toMatch(/ctrl\+e.*edit/);
        expect(frame).toMatch(/ctrl\+x.*delete/);
      },
    );
  });

  promptIt("opens edit for the active environment on ctrl+e", async () => {
    const { answer, events } = await render(
      promptForInteractiveEnvironmentList,
      {
        message: "Filter environments",
        environments: sampleEnvironments,
      },
      { clearPromptOnDone: true },
    );

    events.type("prod");
    events.keypress(CTRL_E);

    await expect(answer).resolves.toEqual({ action: "edit", name: "production" });
  });

  promptIt("confirms delete for the active environment on ctrl+x and y", async () => {
    const { answer, events } = await render(
      promptForInteractiveEnvironmentList,
      {
        message: "Filter environments",
        environments: sampleEnvironments,
      },
      { clearPromptOnDone: true },
    );

    events.type("prod");
    events.keypress(CTRL_X);
    events.keypress("y");

    await expect(answer).resolves.toEqual({ action: "delete", name: "production" });
  });
});
