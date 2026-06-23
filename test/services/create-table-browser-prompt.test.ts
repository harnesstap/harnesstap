import { render } from "@inquirer/testing";
import { describe, expect, it } from "bun:test";
import { createTableBrowserPrompt } from "../../src/services/wizards/prompts/create-table-browser-prompt.ts";

type Row = { id: string; label: string };

describe("createTableBrowserPrompt", () => {
  it("filter intent commits query on esc", async () => {
    const { answer, events } = await render(
      (_config, context) =>
        createTableBrowserPrompt<Row, { query: string }>(
          {
            message: "Filter items",
            intent: { kind: "filter" },
            adapter: {
              resolveItems: (query) => {
                const rows = [{ id: "1", label: "alpha" }];
                const filtered = query
                  ? rows.filter((row) => row.label.includes(query))
                  : rows;
                return { filtered, navigable: filtered };
              },
              renderViewport: ({ navigable, active }) =>
                navigable
                  .map((row, index) => (index === active ? `> ${row.label}` : `  ${row.label}`))
                  .join("\n"),
              helpActions: [["esc", "exit"]],
            },
          },
          context,
        ),
      undefined,
      { clearPromptOnDone: true },
    );
    events.type("al");
    events.keypress("escape");
    await expect(answer).resolves.toEqual({ kind: "filter", query: "al" });
  });

  it("pick-one intent confirms active row on enter", async () => {
    const { answer, events } = await render(
      (_config, context) =>
        createTableBrowserPrompt<Row, string>(
          {
            message: "Pick item",
            intent: { kind: "pick-one", action: "show" },
            adapter: {
              resolveItems: () => ({
                filtered: [{ id: "1", label: "alpha" }],
                navigable: [{ id: "1", label: "alpha" }],
              }),
              renderViewport: ({ navigable }) => navigable.map((row) => row.label).join("\n"),
              onPick: (row) => row.id,
              helpActions: [["⏎", "select"], ["esc", "cancel"]],
            },
          },
          context,
        ),
      undefined,
      { clearPromptOnDone: true },
    );
    events.keypress("enter");
    await expect(answer).resolves.toEqual({ kind: "pick-one", value: "1" });
  });
});
