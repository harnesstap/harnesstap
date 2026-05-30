import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { promptForSearchableMultiSelect } from "../../src/services/wizards/searchable-multi-select.js";

const ENTER = "\n";
const CTRL_A = "\u0001";
const CTRL_X = "\u0018";

async function delay(ms = 5): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPrompt(inputKeys: string[], defaults: string[] = []) {
  const input = new PassThrough();
  Object.assign(input, { isTTY: true });
  const output = new PassThrough();
  Object.assign(output, { isTTY: true, columns: 80, rows: 24 });
  output.resume();

  const answerPromise = promptForSearchableMultiSelect(
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
    { input, output, clearPromptOnDone: true },
  );

  for (const key of inputKeys) {
    input.write(key);
    await delay();
  }

  const answer = await answerPromise;
  input.end();
  output.end();
  return answer;
}

describe("searchable multi-select prompt", () => {
  it("filters choices as you type and toggles the filtered alias with space", async () => {
    const answer = await runPrompt(
      ["c", "o", "p", "i", "l", "o", "t", " ", ENTER],
    );

    expect(answer).toEqual(["copilot-cli"]);
  });

  it("selects all visible filtered aliases with ctrl+a", async () => {
    const answer = await runPrompt(
      ["c", "o", "p", "i", "l", "o", "t", CTRL_A, ENTER],
      ["cursor"],
    );

    expect(answer).toEqual(["copilot-cli", "cursor"]);
  });

  it("clears only the visible filtered aliases with ctrl+x", async () => {
    const answer = await runPrompt(
      ["c", "o", "p", "i", "l", "o", "t", CTRL_X, ENTER],
      ["cursor", "copilot-cli"],
    );

    expect(answer).toEqual(["cursor"]);
  });
});
