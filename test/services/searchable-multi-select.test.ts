import { render } from "@inquirer/testing";
import { describe, expect, it } from "bun:test";
import { promptForSearchableMultiSelect } from "../../src/services/wizards/searchable-multi-select.ts?actual";
import { PromptBackError } from "../../src/services/wizards/shared.ts";

const CTRL_A = { name: "a", ctrl: true } as const;
const CTRL_X = { name: "x", ctrl: true } as const;

function renderPrompt(defaults: string[] = []) {
  return render(
    promptForSearchableMultiSelect,
    {
      message: "Select alias harnesses",
      default: defaults,
      choices: [
        { name: "Claude Code", value: "claude-code" },
        { name: "Copilot CLI", value: "copilot-cli" },
        { name: "Codex", value: "codex" },
        { name: "Cursor", value: "cursor" },
      ],
    },
    { clearPromptOnDone: true },
  );
}

describe("searchable multi-select prompt", () => {
  it("filters choices as you type and toggles the filtered alias with space", async () => {
    const { answer, events } = await renderPrompt();

    events.type("copilot");
    events.keypress("space");
    events.keypress("enter");

    await expect(answer).resolves.toEqual(["copilot-cli"]);
  });

  it("selects all visible filtered aliases with ctrl+a", async () => {
    const { answer, events } = await renderPrompt(["cursor"]);

    events.type("copilot");
    events.keypress(CTRL_A);
    events.keypress("enter");

    await expect(answer).resolves.toEqual(["copilot-cli", "cursor"]);
  });

  it("clears only the visible filtered aliases with ctrl+x", async () => {
    const { answer, events } = await renderPrompt(["cursor", "copilot-cli"]);

    events.type("copilot");
    events.keypress(CTRL_X);
    events.keypress("enter");

    await expect(answer).resolves.toEqual(["cursor"]);
  });

  it("starts with an initial query filter when provided", async () => {
    const { answer, events } = await render(
      promptForSearchableMultiSelect,
      {
        message: "Select resources to delete",
        initialQuery: "copilot",
        choices: [
          { name: "Claude Code", value: "claude-code" },
          { name: "Copilot CLI", value: "copilot-cli" },
          { name: "Codex", value: "codex" },
        ],
      },
      { clearPromptOnDone: true },
    );

    events.keypress("space");
    events.keypress("enter");

    await expect(answer).resolves.toEqual(["copilot-cli"]);
  });

  it("rejects with PromptBackError when escape is pressed", async () => {
    const { answer, events } = await renderPrompt();

    events.keypress("escape");

    await expect(answer).rejects.toBeInstanceOf(PromptBackError);
  });
});
