import { ExitPromptError } from "@inquirer/core";
import { render } from "@inquirer/testing";
import { describe, expect, it } from "bun:test";
import { createTableBrowserPrompt } from "../../src/services/wizards/prompts/create-table-browser-prompt.ts";

type Row = { id: string; label: string; checked?: boolean };

const CTRL_E = { name: "e", ctrl: true } as const;
const CTRL_X = { name: "x", ctrl: true } as const;
const CTRL_S = { name: "s", ctrl: true } as const;

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

  it("filter intent edits the active row on e when onEdit is set", async () => {
    const { answer, events } = await render(
      (_config, context) =>
        createTableBrowserPrompt<Row, string>(
          {
            message: "Filter items",
            intent: { kind: "filter" },
            adapter: {
              resolveItems: () => ({
                filtered: [{ id: "1", label: "alpha" }],
                navigable: [{ id: "1", label: "alpha" }],
              }),
              renderViewport: ({ navigable }) => navigable.map((row) => row.label).join("\n"),
              onEdit: (row) => row.id,
              helpActions: [["ctrl+e", "edit"], ["esc", "exit"]],
            },
          },
          context,
        ),
      undefined,
      { clearPromptOnDone: true },
    );

    events.keypress(CTRL_E);
    await expect(answer).resolves.toEqual({ kind: "edit", value: "1" });
  });

  it("filter intent deletes the active row on d and y when formatDeleteConfirm is set", async () => {
    const { answer, events } = await render(
      (_config, context) =>
        createTableBrowserPrompt<Row, string>(
          {
            message: "Filter items",
            intent: { kind: "filter" },
            adapter: {
              resolveItems: () => ({
                filtered: [{ id: "1", label: "alpha" }],
                navigable: [{ id: "1", label: "alpha" }],
              }),
              renderViewport: ({ navigable }) => navigable.map((row) => row.label).join("\n"),
              onPick: (row) => row.id,
              formatDeleteConfirm: (row) => `Delete ${row.label}?`,
              helpActions: [["ctrl+x", "delete"], ["esc", "exit"]],
            },
          },
          context,
        ),
      undefined,
      { clearPromptOnDone: true },
    );

    events.keypress(CTRL_X);
    events.keypress("y");
    await expect(answer).resolves.toEqual({ kind: "delete", value: "1" });
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

  it("pick-one intent rejects on escape without uncaught throw", async () => {
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

    events.keypress("escape");
    let rejected: unknown;
    try {
      await answer;
      throw new Error("Expected prompt to reject on escape");
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBeInstanceOf(ExitPromptError);
    expect((rejected as Error).message).toBe("Table browser cancelled.");
  });

  it("pick-many intent toggles with space and commits on ctrl+s", async () => {
    const rows: Row[] = [
      { id: "1", label: "alpha", checked: false },
      { id: "2", label: "beta", checked: false },
    ];
    const { answer, events } = await render(
      (_config, context) =>
        createTableBrowserPrompt<Row, Row>(
          {
            message: "Pick items",
            intent: { kind: "pick-many" },
            pickManyItems: rows,
            resolvePickManyItems: (items, query) => {
              const filtered = query
                ? items.filter((row) => row.label.includes(query))
                : items;
              return { filtered, navigable: filtered };
            },
            onCommitPickMany: (items) => items,
            adapter: {
              resolveItems: () => ({ filtered: [], navigable: [] }),
              renderViewport: ({ navigable }) => navigable.map((row) => row.label).join("\n"),
              getItemKey: (row) => row.id,
              helpActions: [["space", "toggle"], ["ctrl+s", "save"]],
            },
          },
          context,
        ),
      undefined,
      { clearPromptOnDone: true },
    );

    events.keypress("space");
    events.keypress(CTRL_S);

    await expect(answer).resolves.toEqual({
      kind: "pick-many",
      values: [
        { id: "1", label: "alpha", checked: true },
        { id: "2", label: "beta", checked: false },
      ],
    });
  });

  it("manage intent returns edit on enter", async () => {
    const rows = [{ id: "1", label: "alpha" }];
    const { answer, events } = await render(
      (_config, context) =>
        createTableBrowserPrompt<(typeof rows)[number], never>(
          {
            message: "Manage items",
            intent: { kind: "manage" },
            manageSourceRows: rows,
            adapter: {
              resolveItems: () => ({ filtered: rows, navigable: rows }),
              renderViewport: ({ navigable }) => navigable.map((row) => row.label).join("\n"),
              helpActions: [["⏎", "edit"], ["a", "add"]],
            },
          },
          context,
        ),
      undefined,
      { clearPromptOnDone: true },
    );

    events.keypress("enter");
    await expect(answer).resolves.toEqual({
      kind: "manage",
      action: { type: "edit", rowIndex: 0 },
    });
  });

  it("manage intent returns add on a", async () => {
    const rows = [{ id: "1", label: "alpha" }];
    const { answer, events } = await render(
      (_config, context) =>
        createTableBrowserPrompt<(typeof rows)[number], never>(
          {
            message: "Manage items",
            intent: { kind: "manage" },
            manageSourceRows: rows,
            adapter: {
              resolveItems: () => ({ filtered: rows, navigable: rows }),
              renderViewport: ({ navigable }) => navigable.map((row) => row.label).join("\n"),
              helpActions: [["a", "add"]],
            },
          },
          context,
        ),
      undefined,
      { clearPromptOnDone: true },
    );
    events.keypress("a");
    await expect(answer).resolves.toEqual({
      kind: "manage",
      action: { type: "add" },
    });
  });

  it("install intent confirms active row on enter", async () => {
    const { answer, events } = await render(
      (_config, context) =>
        createTableBrowserPrompt<Row, string>(
          {
            message: "Install item",
            intent: { kind: "install" },
            adapter: {
              resolveItems: () => ({
                filtered: [{ id: "1", label: "alpha" }],
                navigable: [{ id: "1", label: "alpha" }],
              }),
              renderViewport: ({ navigable }) => navigable.map((row) => row.label).join("\n"),
              onPick: (row) => row.id,
              helpActions: [["⏎", "install"], ["i", "install"]],
            },
          },
          context,
        ),
      undefined,
      { clearPromptOnDone: true },
    );
    events.keypress("enter");
    await expect(answer).resolves.toEqual({ kind: "install", value: "1" });
  });

  it("filter intent scrolls tall show output before returning to browse", async () => {
    const tallShow = Array.from({ length: 30 }, (_, index) => `detail-${index + 1}`).join("\n");
    const { answer, events } = await render(
      (_config, context) =>
        createTableBrowserPrompt<Row, string>(
          {
            message: "Filter items",
            intent: { kind: "filter" },
            adapter: {
              resolveItems: () => ({
                filtered: [{ id: "1", label: "alpha" }],
                navigable: [{ id: "1", label: "alpha" }],
              }),
              renderViewport: ({ navigable }) => navigable.map((row) => row.label).join("\n"),
              renderShow: () => tallShow,
              helpActions: [["esc", "exit"]],
            },
          },
          context,
        ),
      undefined,
      { clearPromptOnDone: true, terminalSize: { columns: 80, rows: 12 } },
    );

    events.keypress("enter");
    events.keypress("down");
    events.keypress("down");
    events.keypress("escape");
    events.keypress("escape");

    await expect(answer).resolves.toEqual({ kind: "filter", query: "" });
  });
});
