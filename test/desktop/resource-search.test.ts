import { describe, expect, it } from "bun:test";
import {
  filterContentsResourcesBySearch,
  filterLibraryResourcesByProfile,
  filterLibraryResourcesBySearch,
  filterPathsBySearch,
  groupLibraryResourcesByType,
  nextVisibleCount,
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

  it("maps legacy plugin_pin: prefix to plugin rows", () => {
    const withPlugin = [
      ...rows,
      resource({ id: "4", type: "plugin", name: "formatter", namespace: "hub" }),
    ];
    expect(
      filterLibraryResourcesBySearch(withPlugin, "plugin_pin:formatter").map(
        (row) => row.id,
      ),
    ).toEqual(["4"]);
    expect(
      filterLibraryResourcesBySearch(withPlugin, "plugin:formatter").map(
        (row) => row.id,
      ),
    ).toEqual(["4"]);
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

describe("filterContentsResourcesBySearch", () => {
  it("supports type:name and case-insensitive substrings", () => {
    const rows = [
      { id: "1", type: "skill", name: "Pair-Agent", source: "/a" },
      { id: "2", type: "rule", name: "api", source: "/b" },
    ];
    expect(
      filterContentsResourcesBySearch(rows, "skill:pair").map((row) => row.id),
    ).toEqual(["1"]);
    expect(
      filterContentsResourcesBySearch(rows, "API").map((row) => row.id),
    ).toEqual(["2"]);
  });
});

describe("list truncation helpers", () => {
  it("filters paths and grows visible counts", () => {
    expect(filterPathsBySearch(["a/foo.md", "b/bar.md"], "foo")).toEqual([
      "a/foo.md",
    ]);
    expect(nextVisibleCount(12, 40)).toBe(24);
    expect(nextVisibleCount(36, 40)).toBe(40);
  });
});
