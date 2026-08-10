import { ExitPromptError } from "@inquirer/core";
import { render } from "@inquirer/testing";
import { describe, expect } from "bun:test";
import { promptIt } from "../helpers/prompt-test.ts";
import { promptForInteractivePluginEdit } from "../../src/services/wizards/interactive-plugin-edit.ts?actual";
import type { PluginEditRow } from "../../src/services/plugin-edit.ts";

const CTRL_S = { name: "s", ctrl: true } as const;

const sampleRows: PluginEditRow[] = [
  {
    id: "skill-1",
    type: "skill",
    name: "helper",
    namespace: "",
    display_name: "helper",
    description: "Helper skill",
    source: "manual",
    origin_kind: "manual",
    origin_ref: "",
    content_hash: "",
    content: "# Helper",
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    checked: false,
  },
  {
    id: "pin-1",
    type: "plugin",
    name: "posthog",
    namespace: "cursor-team-kit",
    display_name: "posthog@cursor-team-kit",
    description: "Plugin dependency",
    source: "composition:plugin",
    origin_kind: "manual",
    origin_ref: "",
    content_hash: "",
    content: "{}",
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-03T00:00:00.000Z",
    checked: false,
  },
];

describe("interactive plugin edit prompt", () => {
  promptIt("toggles a material resource with space and saves on ctrl+s", async () => {
    const { answer, events } = await render(
      promptForInteractivePluginEdit,
      {
        message: "Edit plugin",
        rows: sampleRows,
      },
      { clearPromptOnDone: true },
    );

    events.keypress("space");
    events.keypress(CTRL_S);

    await expect(answer).resolves.toMatchObject({
      rows: expect.arrayContaining([
        expect.objectContaining({ name: "helper", checked: true }),
      ]),
    });
  });

  promptIt("prompts for version constraint when checking a plugin pin", async () => {
    const { answer, events } = await render(
      promptForInteractivePluginEdit,
      {
        message: "Edit plugin",
        rows: sampleRows,
      },
      { clearPromptOnDone: true },
    );

    events.keypress("down");
    events.keypress("space");
    events.keypress("enter");
    events.keypress(CTRL_S);

    await expect(answer).resolves.toMatchObject({
      rows: expect.arrayContaining([
        expect.objectContaining({
          type: "plugin",
          checked: true,
          version_constraint: "latest",
        }),
      ]),
    });
  });

  promptIt("cancels on escape", async () => {
    const { answer, events } = await render(
      promptForInteractivePluginEdit,
      {
        message: "Edit plugin",
        rows: sampleRows,
      },
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
    expect((rejected as Error).message).toBe("Plugin edit cancelled");
  });
});
