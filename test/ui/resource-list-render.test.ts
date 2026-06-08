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

  it("shows only the first 10 resources per type by default", () => {
    const rows = toResourceListRows(
      Array.from({ length: 12 }, (_, index) => ({
        ...makeResourceInput({
          type: "rule",
          name: `rule-${index + 1}`,
          description: `Rule ${index + 1}`,
        }),
        id: `rule-${index + 1}`,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: new Date(Date.UTC(2026, 0, 12 - index)).toISOString(),
      })),
    );

    const output = renderGroupedResourceListTables(rows, { showId: false });
    expect(output).toContain("rule (12)");
    expect(output).toContain("rule-1");
    expect(output).toContain("rule-10");
    expect(output).not.toContain("rule-11");
    expect(output).toContain("… and 2 more resources (use --all to show all)");
  });

  it("shows all resources per type when showAll is set", () => {
    const rows = toResourceListRows(
      Array.from({ length: 12 }, (_, index) => ({
        ...makeResourceInput({
          type: "rule",
          name: `rule-${index + 1}`,
        }),
        id: `rule-${index + 1}`,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: new Date(Date.UTC(2026, 0, 12 - index)).toISOString(),
      })),
    );

    const output = renderGroupedResourceListTables(rows, { showId: false, showAll: true });
    expect(output).toContain("rule-11");
    expect(output).toContain("rule-12");
    expect(output).not.toContain("… and");
  });
});
