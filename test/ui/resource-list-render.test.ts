import { describe, expect, it } from "bun:test";
import {
  filterResourcesBySearch,
  formatResourceListNamespace,
  listNavigableResources,
  renderGroupedResourceListTables,
  renderGroupedResourceListViewport,
  toResourceListRows,
} from "../../src/ui/resource-list-render.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("resource list render", () => {
  it("filters by skill:dbt type prefix", () => {
    const rows = toResourceListRows([
      {
        ...makeResourceInput({ type: "skill", name: "migrating-dbt-core" }),
        id: "s1",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
      {
        ...makeResourceInput({ type: "rule", name: "dbt-style-guide" }),
        id: "r1",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-03T00:00:00.000Z",
      },
    ]);
    const filtered = filterResourcesBySearch(rows, "skill:dbt");
    expect(filtered.map((row) => row.name)).toEqual(["migrating-dbt-core"]);
  });

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

  it("formatResourceListNamespace enriches marketplace_link origin_ref", () => {
    const row = toResourceListRows([{
      ...makeResourceInput({ type: "skill", name: "team" }),
      id: "1", namespace: "cursor-team-kit", origin_kind: "marketplace_link",
      origin_ref: "cursor-team-kit@team-marketplace",
      created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z",
    }])[0];
    expect(formatResourceListNamespace(row)).toBe("team-marketplace/cursor-team-kit");
  });

  it("renders bare name in NAME column without @namespace suffix", () => {
    const rows = toResourceListRows([{
      ...makeResourceInput({ type: "skill", name: "migrating-dbt-core-to-fusion" }),
      id: "1", namespace: "dbt-labs/dbt-agent-skills",
      created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z",
    }]);
    const output = renderGroupedResourceListTables(rows, { showId: false, maxWidth: 100 });
    expect(output).toContain("migrating-dbt-core-to-fusion");
    expect(output).not.toContain("migrating-dbt-core-to-fusion@");
    expect(output).toContain("dbt-labs/dbt-agent-skills");
  });
});

describe("resource viewport footer hints", () => {
  it("builds foldable hint segments for overflow", () => {
    const rows = toResourceListRows(
      Array.from({ length: 8 }, (_, i) => ({
        ...makeResourceInput({ type: "skill", name: `skill-${i + 1}` }),
        id: `skill-${i + 1}`,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      })),
    );
    const navigable = listNavigableResources(rows);
    const output = renderGroupedResourceListViewport(rows, {
      showId: false,
      activeIndex: 5,
      navigable,
      terminalRows: 12,
      maxWidth: 120,
    });
    expect(output).toContain("above");
  });

  it("folds footer hints on one line when width allows", () => {
    const skillRows = toResourceListRows(
      Array.from({ length: 6 }, (_, i) => ({
        ...makeResourceInput({ type: "skill", name: `skill-${i + 1}` }),
        id: `skill-${i + 1}`,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      })),
    );
    const ruleRows = toResourceListRows([
      {
        ...makeResourceInput({ type: "rule", name: "rule-1" }),
        id: "rule-1",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    ]);
    const rows = [...skillRows, ...ruleRows];
    const navigable = listNavigableResources(rows);
    const output = renderGroupedResourceListViewport(rows, {
      showId: false,
      activeIndex: 5,
      navigable,
      terminalRows: 14,
      maxWidth: 120,
    });
    const footerLines = output.split("\n").filter((line) => line.includes("next type"));
    expect(footerLines.length).toBe(1);
  });
});
