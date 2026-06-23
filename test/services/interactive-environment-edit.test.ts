import { render } from "@inquirer/testing";
import { describe, expect } from "bun:test";
import { promptIt, withPrompt } from "../helpers/prompt-test.ts";
import { promptForInteractiveEnvironmentEdit } from "../../src/services/wizards/interactive-environment-edit.ts?actual";

describe("interactive environment edit prompt", () => {
  promptIt("returns cancel when escape is pressed", async () => {
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

  promptIt("does not render Active selection line in browse view", async () => {
    await withPrompt(
      render(
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
      ),
      ({ getScreen }) => {
        const frame = getScreen();
        expect(frame).not.toMatch(/\nActive: /);
        expect(frame).toMatch(/Search:/);
      },
    );
  });
});
