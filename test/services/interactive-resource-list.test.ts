import { render } from "@inquirer/testing";
import { describe, expect } from "bun:test";
import { promptIt, withPrompt } from "../helpers/prompt-test.ts";
import { promptForInteractiveResourceList } from "../../src/services/wizards/interactive-resource-list.ts?actual";

const CTRL_X = { name: "x", ctrl: true } as const;

const sampleResources = [
  {
    id: "skill-1",
    type: "skill",
    name: "shared-skill",
    namespace: "",
    display_name: "shared-skill",
    description: "Shared helper",
    source: "manual",
    origin_kind: "manual",
    origin_ref: "",
    content_hash: "",
    content: "# Shared",
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "rule-1",
    type: "rule",
    name: "api-design",
    namespace: "",
    display_name: "api-design",
    description: "API endpoint design patterns",
    source: "manual",
    origin_kind: "manual",
    origin_ref: "",
    content_hash: "",
    content: "# API",
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-03T00:00:00.000Z",
  },
] as const;

describe("interactive resource list prompt", () => {
  promptIt("filters grouped tables as you type and exits with the query on esc", async () => {
    const { answer, events } = await render(
      promptForInteractiveResourceList,
      {
        message: "Filter resources",
        resources: [...sampleResources],
      },
      { clearPromptOnDone: true },
    );

    events.type("api");
    events.keypress("escape");

    await expect(answer).resolves.toEqual({ action: "filter", query: "api" });
  });

  promptIt("shows a resource on enter and returns to browse on esc", async () => {
    const { answer, events } = await render(
      promptForInteractiveResourceList,
      {
        message: "Filter resources",
        resources: [...sampleResources],
      },
      { clearPromptOnDone: true },
    );

    events.type("api");
    events.keypress("enter");
    events.keypress("escape");
    events.keypress("escape");

    await expect(answer).resolves.toEqual({ action: "filter", query: "api" });
  });

  promptIt("moves selection with arrow keys before showing a resource", async () => {
    const { answer, events } = await render(
      promptForInteractiveResourceList,
      {
        message: "Filter resources",
        resources: [...sampleResources],
      },
      { clearPromptOnDone: true },
    );

    events.keypress("down");
    events.keypress("enter");
    events.keypress("escape");
    events.keypress("escape");

    await expect(answer).resolves.toEqual({ action: "filter", query: "" });
  });

  promptIt("deletes a resource with ctrl+x after confirm", async () => {
    const { answer, events } = await render(
      promptForInteractiveResourceList,
      {
        message: "Filter resources",
        resources: [...sampleResources],
      },
      { clearPromptOnDone: true },
    );

    events.keypress(CTRL_X);
    events.keypress("y");

    await expect(answer).resolves.toEqual({ action: "delete", name: "skill-1" });
  });

  promptIt("does not render Active or Show selection line in browse view", async () => {
    await withPrompt(
      render(
        promptForInteractiveResourceList,
        {
          message: "Filter resources",
          resources: [...sampleResources],
        },
        { clearPromptOnDone: true },
      ),
      ({ getScreen }) => {
        const frame = getScreen();
        expect(frame).not.toMatch(/\nShow: /);
        expect(frame).not.toMatch(/\nActive: /);
      },
    );
  });
});
