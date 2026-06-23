import { describe, expect, it } from "bun:test";
import {
  filterEnvironmentsBySearch,
  renderEnvironmentListShow,
  renderEnvironmentListTable,
  renderEnvironmentListViewport,
  type EnvironmentListRow,
} from "../../src/ui/environment-list-render.ts";

function makeRow(input: {
  name: string;
  description?: string;
  value_count?: number;
  secret_ref_count?: number;
  reference_count?: number;
}): EnvironmentListRow {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    environment: {
      id: `env-${input.name}`,
      name: input.name,
      description: input.description ?? "",
      created_at: now,
      updated_at: now,
    },
    value_count: input.value_count ?? 0,
    secret_ref_count: input.secret_ref_count ?? 0,
    reference_count: input.reference_count ?? 0,
  };
}

describe("environment list render", () => {
  it("filters by name prefix", () => {
    const rows = [
      makeRow({ name: "production", description: "Prod env" }),
      makeRow({ name: "staging", description: "Staging env" }),
    ];
    const filtered = filterEnvironmentsBySearch(rows, "name:prod");
    expect(filtered.map((row) => row.environment.name)).toEqual(["production"]);
  });

  it("filters by description prefix", () => {
    const rows = [
      makeRow({ name: "alpha", description: "Primary workspace" }),
      makeRow({ name: "beta", description: "Secondary workspace" }),
    ];
    const filtered = filterEnvironmentsBySearch(rows, "desc:primary");
    expect(filtered.map((row) => row.environment.name)).toEqual(["alpha"]);
  });

  it("filters by free-text name and description", () => {
    const rows = [
      makeRow({ name: "dev", description: "Local development" }),
      makeRow({ name: "prod", description: "Production deployment" }),
    ];
    const filtered = filterEnvironmentsBySearch(rows, "local");
    expect(filtered.map((row) => row.environment.name)).toEqual(["dev"]);
  });

  it("renders a static table with counts", () => {
    const rows = [
      makeRow({
        name: "prod",
        value_count: 3,
        secret_ref_count: 1,
        reference_count: 2,
      }),
    ];
    const output = renderEnvironmentListTable(rows, { maxWidth: 100 });
    expect(output).toContain("prod");
    expect(output).toContain("3");
    expect(output).toContain("1");
    expect(output).toContain("2");
  });

  it("renders viewport with folded overflow hints", () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      makeRow({ name: `env-${index + 1}` }),
    );
    const output = renderEnvironmentListViewport({
      activeIndex: 10,
      navigable: rows,
      terminalRows: 12,
      maxWidth: 80,
    });
    expect(output).toContain("env-11");
    expect(output).toMatch(/↑ \d+ above/);
  });

  it("renders environment show summary", () => {
    const row = makeRow({
      name: "prod",
      description: "Production",
      value_count: 4,
      secret_ref_count: 2,
      reference_count: 1,
    });
    const output = renderEnvironmentListShow(row);
    expect(output).toContain("prod");
    expect(output).toContain("Production");
    expect(output).toContain("Values: 4");
    expect(output).toContain("Secret refs: 2");
    expect(output).toContain("Layer references: 1");
  });
});
