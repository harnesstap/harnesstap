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
});
