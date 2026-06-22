import { describe, expect, it } from "bun:test";
import {
  computeMaxVisibleRows,
  renderGroupedResourceListViewport,
  resolveActiveSectionContext,
  resolveSectionViewport,
  toResourceListRows,
} from "../../src/ui/resource-list-render.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("resolveSectionViewport", () => {
  it("returns full section when it fits", () => {
    expect(resolveSectionViewport(5, 2, 10)).toEqual({ start: 0, end: 5 });
  });

  it("keeps active index centered when possible", () => {
    expect(resolveSectionViewport(20, 10, 5)).toEqual({ start: 8, end: 13 });
  });

  it("pins to top when active is near start", () => {
    expect(resolveSectionViewport(20, 1, 5)).toEqual({ start: 0, end: 5 });
  });

  it("pins to bottom when active is near end", () => {
    expect(resolveSectionViewport(20, 18, 5)).toEqual({ start: 15, end: 20 });
  });
});

describe("computeMaxVisibleRows", () => {
  it("reserves chrome and table overhead", () => {
    expect(computeMaxVisibleRows(24)).toBeGreaterThanOrEqual(3);
    expect(computeMaxVisibleRows(12)).toBeLessThan(computeMaxVisibleRows(40));
  });
});

describe("resolveActiveSectionContext", () => {
  it("resolves section and neighbors for flat navigable list", () => {
    const rows = toResourceListRows([
      {
        ...makeResourceInput({ type: "skill", name: "a" }),
        id: "s1",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
      {
        ...makeResourceInput({ type: "rule", name: "b" }),
        id: "r1",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-03T00:00:00.000Z",
      },
    ]);
    const navigable = rows;
    const ctx = resolveActiveSectionContext(navigable, 1);
    expect(ctx.type).toBe("rule");
    expect(ctx.indexInSection).toBe(0);
    expect(ctx.prevSection).toEqual({ type: "skill", count: 1 });
    expect(ctx.nextSection).toBeUndefined();
  });
});

describe("renderGroupedResourceListViewport", () => {
  it("renders only the active type subheader", () => {
    const rows = toResourceListRows([
      {
        ...makeResourceInput({ type: "skill", name: "alpha" }),
        id: "s1",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
      {
        ...makeResourceInput({ type: "skill", name: "beta" }),
        id: "s2",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-03T00:00:00.000Z",
      },
      {
        ...makeResourceInput({ type: "rule", name: "gamma" }),
        id: "r1",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-04T00:00:00.000Z",
      },
    ]);
    const navigable = rows;
    const output = renderGroupedResourceListViewport(rows, {
      showId: false,
      activeIndex: 0,
      navigable,
      terminalRows: 24,
      maxWidth: 80,
      selectedResourceId: "s1",
    });
    expect(output).toContain("alpha");
    expect(output).not.toContain("gamma");
  });

  it("shows overflow hint when section has more rows than viewport", () => {
    const rows = toResourceListRows(
      Array.from({ length: 15 }, (_, index) => ({
        ...makeResourceInput({ type: "skill", name: `skill-${index + 1}` }),
        id: `s${index}`,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: new Date(Date.UTC(2026, 0, 15 - index)).toISOString(),
      })),
    );
    const output = renderGroupedResourceListViewport(rows, {
      showId: false,
      activeIndex: 10,
      navigable: rows,
      terminalRows: 12,
      maxWidth: 80,
      selectedResourceId: "s10",
    });
    expect(output).toContain("more");
  });
});
