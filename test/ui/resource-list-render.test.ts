import { describe, expect, it } from "bun:test";
import {
  filterResourcesBySearch,
  renderGroupedResourceListTables,
  toResourceListRows,
} from "../../src/ui/resource-list-render.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("resource list render", () => {
  it("filters resources by name and description", () => {
    const rows = toResourceListRows([
      {
        ...makeResourceInput({
          type: "skill",
          name: "shared-skill",
          description: "Shared helper",
        }),
        id: "skill-1",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
      {
        ...makeResourceInput({
          type: "rule",
          name: "api-design",
          description: "API endpoint design patterns",
        }),
        id: "rule-1",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-03T00:00:00.000Z",
      },
    ]);

    const filtered = filterResourcesBySearch(rows, "api");
    expect(filtered.map((row) => row.name)).toEqual(["api-design"]);
  });

  it("renders grouped tables with type subheaders", () => {
    const rows = toResourceListRows([
      {
        ...makeResourceInput({ type: "skill", name: "alpha" }),
        id: "skill-1",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
      {
        ...makeResourceInput({ type: "rule", name: "beta" }),
        id: "rule-1",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-03T00:00:00.000Z",
      },
    ]);

    const output = renderGroupedResourceListTables(rows, { showId: false });
    expect(output).toContain("skill");
    expect(output).toContain("rule");
    expect(output).toContain("alpha");
    expect(output).toContain("beta");
    expect(output).toContain("2 resources");
  });
});
