import { describe, expect, it } from "bun:test";
import {
  LISTABLE_FILTER_RESOURCE_TYPES,
  applyLibraryResourceFilters,
  buildNamespaceFacetOptions,
  buildOriginFacetOptions,
  defaultResourceFilterState,
  formatOriginKindLabel,
  isResourceFilterStateActive,
  isUpdatedFilterValid,
  resetResourceFilterState,
  resolveUpdatedAtBounds,
  type ResourceFilterState,
} from "../../apps/desktop/src/lib/resource-filters.ts";
import type { LibraryResource } from "../../apps/desktop/src/lib/types.ts";

function resource(
  partial: Partial<LibraryResource> &
    Pick<LibraryResource, "id" | "name" | "type">,
): LibraryResource {
  return {
    namespace: null,
    description: null,
    updated_at: "2026-08-01T12:00:00.000Z",
    origin_kind: "manual",
    ...partial,
  };
}

const rows: LibraryResource[] = [
  resource({
    id: "1",
    type: "skill",
    name: "migrating-dbt-core",
    description: "DBT migration helpers",
    updated_at: "2026-08-05T15:00:00.000Z",
    origin_kind: "manual",
  }),
  resource({
    id: "2",
    type: "rule",
    name: "api-design",
    namespace: "team",
    description: "API endpoint design patterns",
    updated_at: "2026-06-01T12:00:00.000Z",
    origin_kind: "local_snapshot",
  }),
  resource({
    id: "3",
    type: "skill",
    name: "shared",
    namespace: "team",
    description: "Shared helper",
    updated_at: "2026-08-07T08:00:00.000Z",
    origin_kind: "marketplace_link",
  }),
];

describe("LISTABLE_FILTER_RESOURCE_TYPES", () => {
  it("includes plugin and excludes plugin_pin", () => {
    expect(LISTABLE_FILTER_RESOURCE_TYPES).toContain("plugin");
    expect(LISTABLE_FILTER_RESOURCE_TYPES).not.toContain("plugin_pin");
    expect(LISTABLE_FILTER_RESOURCE_TYPES).toContain("skill");
  });
});

describe("applyLibraryResourceFilters", () => {
  it("returns all rows for default state", () => {
    expect(
      applyLibraryResourceFilters(rows, defaultResourceFilterState()).map(
        (r) => r.id,
      ),
    ).toEqual(["1", "2", "3"]);
  });

  it("ANDs type badge with search text", () => {
    const state: ResourceFilterState = {
      ...defaultResourceFilterState(),
      search: "shared",
      type: "skill",
    };
    expect(
      applyLibraryResourceFilters(rows, state).map((r) => r.id),
    ).toEqual(["3"]);
  });

  it("yields empty when type badge conflicts with type: prefix", () => {
    const state: ResourceFilterState = {
      ...defaultResourceFilterState(),
      search: "skill:api",
      type: "rule",
    };
    expect(applyLibraryResourceFilters(rows, state)).toEqual([]);
  });

  it("filters namespace exact and unnamed", () => {
    expect(
      applyLibraryResourceFilters(rows, {
        ...defaultResourceFilterState(),
        namespace: { mode: "named", value: "team" },
      }).map((r) => r.id),
    ).toEqual(["2", "3"]);

    expect(
      applyLibraryResourceFilters(rows, {
        ...defaultResourceFilterState(),
        namespace: { mode: "unnamed" },
      }).map((r) => r.id),
    ).toEqual(["1"]);
  });

  it("filters origin_kind", () => {
    expect(
      applyLibraryResourceFilters(rows, {
        ...defaultResourceFilterState(),
        originKind: "marketplace_link",
      }).map((r) => r.id),
    ).toEqual(["3"]);
  });

  it("filters updated_at with 7d preset using injected now", () => {
    const now = new Date(2026, 7, 8, 12, 0, 0); // local Aug 8, 2026
    const filtered = applyLibraryResourceFilters(
      rows,
      {
        ...defaultResourceFilterState(),
        updated: { preset: "7d", from: null, to: null },
      },
      now,
    );
    expect(filtered.map((r) => r.id).sort()).toEqual(["1", "3"]);
  });

  it("filters updated_at with 1d preset using injected now", () => {
    const now = new Date(2026, 7, 7, 12, 0, 0); // local Aug 7, 2026
    const filtered = applyLibraryResourceFilters(
      rows,
      {
        ...defaultResourceFilterState(),
        updated: { preset: "1d", from: null, to: null },
      },
      now,
    );
    expect(filtered.map((r) => r.id)).toEqual(["3"]);
  });

  it("applies inclusive custom local-date range", () => {
    const filtered = applyLibraryResourceFilters(rows, {
      ...defaultResourceFilterState(),
      updated: {
        preset: "custom",
        from: "2026-08-05",
        to: "2026-08-05",
      },
    });
    expect(filtered.map((r) => r.id)).toEqual(["1"]);
  });

  it("skips date filtering when custom range is invalid", () => {
    const state: ResourceFilterState = {
      ...defaultResourceFilterState(),
      updated: { preset: "custom", from: "2026-08-10", to: "2026-08-01" },
    };
    expect(isUpdatedFilterValid(state.updated)).toBe(false);
    expect(
      applyLibraryResourceFilters(rows, state).map((r) => r.id),
    ).toEqual(["1", "2", "3"]);
  });

  it("excludes rows missing updated_at when a date filter is active", () => {
    const withMissing = [
      ...rows,
      resource({
        id: "4",
        type: "skill",
        name: "legacy",
        updated_at: null,
      }),
    ];
    const filtered = applyLibraryResourceFilters(
      withMissing,
      {
        ...defaultResourceFilterState(),
        updated: { preset: "7d", from: null, to: null },
      },
      new Date(2026, 7, 8, 12, 0, 0),
    );
    expect(filtered.map((r) => r.id)).not.toContain("4");
  });
});

describe("facet options", () => {
  it("builds namespace options from full library including unnamed", () => {
    expect(buildNamespaceFacetOptions(rows)).toEqual([
      { mode: "unnamed" },
      { mode: "named", value: "team" },
    ]);
  });

  it("builds origin options sorted from full library", () => {
    expect(buildOriginFacetOptions(rows)).toEqual([
      "local_snapshot",
      "manual",
      "marketplace_link",
    ]);
  });

  it("formats origin kinds as human-readable labels", () => {
    expect(formatOriginKindLabel("local_snapshot")).toBe("Local snapshot");
    expect(formatOriginKindLabel("marketplace_link")).toBe("Marketplace");
    expect(formatOriginKindLabel("manual")).toBe("Manual");
    expect(formatOriginKindLabel("other_kind")).toBe("other kind");
  });
});

describe("resolveUpdatedAtBounds", () => {
  it("resolves 1d preset to local calendar day", () => {
    const now = new Date(2026, 7, 8, 18, 30, 0);
    const bounds = resolveUpdatedAtBounds(
      { preset: "1d", from: null, to: null },
      now,
    );
    expect(bounds).not.toBeNull();
    expect(bounds?.start.getFullYear()).toBe(2026);
    expect(bounds?.start.getMonth()).toBe(7);
    expect(bounds?.start.getDate()).toBe(8);
    expect(bounds?.end.getDate()).toBe(8);
  });

  it("resolves 30d preset to local calendar window", () => {
    const now = new Date(2026, 7, 8, 18, 30, 0);
    const bounds = resolveUpdatedAtBounds(
      { preset: "30d", from: null, to: null },
      now,
    );
    expect(bounds).not.toBeNull();
    expect(bounds?.start.getFullYear()).toBe(2026);
    expect(bounds?.start.getMonth()).toBe(6); // July
    expect(bounds?.start.getDate()).toBe(10);
    expect(bounds?.end.getDate()).toBe(8);
  });

  it("returns null bounds for all-time", () => {
    expect(
      resolveUpdatedAtBounds(
        { preset: "all", from: null, to: null },
        new Date(),
      ),
    ).toBeNull();
  });
});

describe("filter state helpers", () => {
  it("detects active filters and resets", () => {
    const dirty: ResourceFilterState = {
      ...defaultResourceFilterState(),
      search: "x",
      type: "skill",
    };
    expect(isResourceFilterStateActive(dirty)).toBe(true);
    expect(isResourceFilterStateActive(resetResourceFilterState())).toBe(
      false,
    );
  });
});
