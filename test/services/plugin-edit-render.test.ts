import { describe, expect, it } from "bun:test";
import { renderGroupedPluginEditTables } from "../../src/ui/resource-list-render.ts";

describe("plugin edit render", () => {
  it("renders checked rows with checkbox prefix in grouped tables", () => {
    const output = renderGroupedPluginEditTables(
      [
        {
          id: "1",
          type: "skill",
          name: "helper",
          namespace: "",
          display_name: "helper",
          description: "",
          checked: true,
          updated_at: "2026-01-02T00:00:00.000Z",
          source: "manual",
          origin_kind: "manual",
          origin_ref: "",
          content_hash: "",
          content: "",
          metadata: {},
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      { showId: false, showAll: true, activeRowId: "1" },
    );
    expect(output).toContain("[x]");
    expect(output).toContain("helper");
    expect(output).toContain("1 selected");
  });
});
