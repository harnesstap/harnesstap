import { render } from "@inquirer/testing";
import { describe, expect, it } from "bun:test";
import { promptForInteractiveResourceList } from "../../src/services/wizards/interactive-resource-list.ts?actual";

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
  it("filters grouped tables as you type and exits with the query on esc", async () => {
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

    await expect(answer).resolves.toEqual({ query: "api" });
  });

  it("shows a resource on enter and returns to browse on esc", async () => {
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

    await expect(answer).resolves.toEqual({ query: "api" });
  });

  it("moves selection with arrow keys before showing a resource", async () => {
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

    await expect(answer).resolves.toEqual({ query: "" });
  });

  it("does not render Active or Show selection line in browse view", async () => {
    const { getScreen } = await render(
      promptForInteractiveResourceList,
      {
        message: "Filter resources",
        resources: [...sampleResources],
      },
      { clearPromptOnDone: true },
    );

    const frame = getScreen();
    expect(frame).not.toMatch(/\nShow: /);
    expect(frame).not.toMatch(/\nActive: /);
  });
});
