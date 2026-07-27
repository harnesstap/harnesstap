import { describe, expect, it } from "bun:test";
import {
  filterLibraryResourcesByProfile,
  filterLibraryResourcesBySearch,
  groupLibraryResourcesByType,
} from "../../apps/desktop/src/lib/resource-search.ts";
import type { LibraryResource } from "../../apps/desktop/src/lib/types.ts";

function resource(
  partial: Partial<LibraryResource> & Pick<LibraryResource, "id" | "name" | "type">,
): LibraryResource {
  return {
    namespace: null,
    description: null,
    ...partial,
  };
}

describe("filterLibraryResourcesBySearch", () => {
  const rows = [
    resource({
      id: "1",
      type: "skill",
      name: "migrating-dbt-core",
      description: "DBT migration helpers",
    }),
    resource({
      id: "2",
      type: "rule",
      name: "api-design",
      description: "API endpoint design patterns",
    }),
    resource({
      id: "3",
      type: "skill",
      name: "shared",
      namespace: "team",
      description: "Shared helper",
    }),
  ];

  it("filters by skill: prefix like the CLI", () => {
    const filtered = filterLibraryResourcesBySearch(rows, "skill:dbt");
    expect(filtered.map((row) => row.name)).toEqual(["migrating-dbt-core"]);
  });

  it("filters by plain text across name and description", () => {
    const filtered = filterLibraryResourcesBySearch(rows, "api");
    expect(filtered.map((row) => row.name)).toEqual(["api-design"]);
  });

  it("matches namespace display form", () => {
    const filtered = filterLibraryResourcesBySearch(rows, "shared@team");
    expect(filtered.map((row) => row.id)).toEqual(["3"]);
  });

  it("returns all rows for empty search", () => {
    expect(filterLibraryResourcesBySearch(rows, "  ")).toEqual(rows);
  });
});

describe("filterLibraryResourcesByProfile", () => {
  it("keeps library rows that appear in the profile stack", () => {
    const library = [
      resource({ id: "1", type: "skill", name: "alpha" }),
      resource({ id: "2", type: "rule", name: "beta" }),
      resource({ id: "3", type: "skill", name: "gamma" }),
    ];
    const filtered = filterLibraryResourcesByProfile(library, [
      { type: "skill", name: "alpha" },
      { type: "rule", name: "beta" },
    ]);
    expect(filtered.map((row) => row.id)).toEqual(["1", "2"]);
  });

  it("returns empty when profile resources are missing (older agent payloads)", () => {
    const library = [resource({ id: "1", type: "skill", name: "alpha" })];
    expect(filterLibraryResourcesByProfile(library, undefined)).toEqual([]);
    expect(filterLibraryResourcesByProfile(library, null)).toEqual([]);
  });
});

describe("groupLibraryResourcesByType", () => {
  it("groups and sorts by type then display name", () => {
    const groups = groupLibraryResourcesByType([
      resource({ id: "1", type: "skill", name: "zeta" }),
      resource({ id: "2", type: "rule", name: "alpha" }),
      resource({ id: "3", type: "skill", name: "alpha" }),
    ]);
    expect(groups.map((group) => group.type)).toEqual(["rule", "skill"]);
    expect(groups[1]?.resources.map((row) => row.name)).toEqual([
      "alpha",
      "zeta",
    ]);
  });
});
