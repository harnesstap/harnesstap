import { render } from "@inquirer/testing";
import { describe, expect, it } from "bun:test";
import { promptForInteractiveEnvironmentList } from "../../src/services/wizards/interactive-environment-list.ts?actual";
import type { EnvironmentListRow } from "../../src/ui/environment-list-render.ts";

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
  it("filters the table as you type and exits with the query on esc", async () => {
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

    await expect(answer).resolves.toEqual({ query: "prod" });
  });

  it("shows an environment on enter and returns to browse on esc", async () => {
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

    await expect(answer).resolves.toEqual({ query: "prod" });
  });

  it("does not render Active or Show selection line in browse view", async () => {
    const { getScreen } = await render(
      promptForInteractiveEnvironmentList,
      {
        message: "Filter environments",
        environments: sampleEnvironments,
      },
      { clearPromptOnDone: true },
    );

    const frame = getScreen();
    expect(frame).not.toMatch(/\nShow: /);
    expect(frame).not.toMatch(/\nActive: /);
  });
});
