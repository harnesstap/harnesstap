import { render } from "@inquirer/testing";
import { describe, expect, it } from "bun:test";
import { promptForInteractiveResourceList } from "../../src/services/wizards/interactive-resource-list.ts?actual";

describe("interactive resource list prompt", () => {
  it("filters grouped tables as you type and returns the query on enter", async () => {
    const { answer, events } = await render(
      promptForInteractiveResourceList,
      {
        message: "Filter resources",
        resources: [
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
        ],
      },
      { clearPromptOnDone: true },
    );

    events.type("api");
    events.keypress("enter");

    await expect(answer).resolves.toBe("api");
  });
});
