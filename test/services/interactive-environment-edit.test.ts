import { render } from "@inquirer/testing";
import { describe, expect, it } from "bun:test";
import { promptForInteractiveEnvironmentEdit } from "../../src/services/wizards/interactive-environment-edit.ts?actual";

describe("interactive environment edit prompt", () => {
  it("returns cancel when escape is pressed", async () => {
    const { answer, events } = await render(
      promptForInteractiveEnvironmentEdit,
      {
        message: "Edit environment prod",
        rows: [
          {
            kind: "secret_ref",
            key: "test",
            provider: "file",
            ref: "testvalue",
          },
        ],
      },
      { clearPromptOnDone: true },
    );

    events.keypress("escape");

    await expect(answer).resolves.toEqual({ type: "cancel" });
  });

  it("does not render Active selection line in browse view", async () => {
    const { getScreen } = await render(
      promptForInteractiveEnvironmentEdit,
      {
        message: "Edit environment prod",
        rows: [
          {
            kind: "env_var",
            key: "PD_REGION",
            value: "eu",
          },
          {
            kind: "secret_ref",
            key: "test",
            provider: "file",
            ref: "testvalue",
          },
        ],
      },
      { clearPromptOnDone: true },
    );

    const frame = getScreen();
    expect(frame).not.toMatch(/\nActive: /);
    expect(frame).toMatch(/Search:/);
  });
});
