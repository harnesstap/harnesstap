import { ExitPromptError } from "@inquirer/core";
import { render } from "@inquirer/testing";
import { describe, expect, it } from "bun:test";
import { promptForInteractiveLayerEdit } from "../../src/services/wizards/interactive-layer-edit.ts?actual";
import type { LayerEditRow } from "../../src/services/layer-edit.ts";

const CTRL_S = { name: "s", ctrl: true } as const;

const sampleRows: LayerEditRow[] = [
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
    type: "plugin_pin",
    name: "posthog",
    namespace: "cursor-team-kit",
    display_name: "posthog@cursor-team-kit",
    description: "Plugin pin",
    source: "composition:plugin_pin",
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

describe("interactive layer edit prompt", () => {
  it("toggles a material resource with space and saves on ctrl+s", async () => {
    const { answer, events } = await render(
      promptForInteractiveLayerEdit,
      {
        message: "Edit layer",
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

  it("prompts for version constraint when checking a plugin pin", async () => {
    const { answer, events } = await render(
      promptForInteractiveLayerEdit,
      {
        message: "Edit layer",
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
          type: "plugin_pin",
          checked: true,
          version_constraint: "latest",
        }),
      ]),
    });
  });

  it("cancels on escape", async () => {
    const { answer, events } = await render(
      promptForInteractiveLayerEdit,
      {
        message: "Edit layer",
        rows: sampleRows,
      },
      { clearPromptOnDone: true },
    );

    expect(() => events.keypress("escape")).toThrow(ExitPromptError);
    void answer.catch(() => undefined);
  });
});
