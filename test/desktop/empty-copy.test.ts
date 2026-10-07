import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  catalogListEmptyKind,
  discoverEmptyKind,
  noResultsTitle,
} from "../../apps/desktop/src/lib/empty-copy.ts";
import { readDesktopCss } from "./helpers/desktop-css.ts";

const root = join(import.meta.dir, "../..");
const designSource = readFileSync(join(root, "apps/desktop/DESIGN.md"), "utf8");
const emptyStateSource = readFileSync(
  join(root, "apps/desktop/src/components/EmptyState.tsx"),
  "utf8",
);
const css = readDesktopCss();

describe("noResultsTitle", () => {
  test("quotes a trimmed query and falls back without one", () => {
    expect(noResultsTitle("")).toBe("No results");
    expect(noResultsTitle("   ")).toBe("No results");
    expect(noResultsTitle(" ship ")).toBe('No results for "ship"');
  });
});

describe("catalogListEmptyKind", () => {
  test("treats All=0 as a real empty, not a filter miss", () => {
    expect(
      catalogListEmptyKind({
        unfilteredCount: 0,
        visibleCount: 0,
        filterActive: false,
      }),
    ).toBe("catalog-empty");
    expect(
      catalogListEmptyKind({
        unfilteredCount: 0,
        visibleCount: 0,
        filterActive: true,
      }),
    ).toBe("catalog-empty");
  });

  test("uses filter-miss copy only when a filter hid rows", () => {
    expect(
      catalogListEmptyKind({
        unfilteredCount: 4,
        visibleCount: 0,
        filterActive: true,
      }),
    ).toBe("filter-empty");
    expect(
      catalogListEmptyKind({
        unfilteredCount: 4,
        visibleCount: 2,
        filterActive: true,
      }),
    ).toBe("none");
  });
});

describe("discoverEmptyKind", () => {
  test("offers clear-search only when a query is present", () => {
    expect(discoverEmptyKind({ query: "ship" })).toBe("clear-search");
    expect(discoverEmptyKind({ query: "" })).toBeNull();
  });
});

describe("empty state recipe", () => {
  test("EmptyState is a status region with a title and optional action", () => {
    expect(emptyStateSource).toContain('role="status"');
    expect(emptyStateSource).toContain("empty-state-actions");
    expect(emptyStateSource).toContain("IconActionButton");
  });

  test("DESIGN.md locks the empty-state heading, why, and miss copy", () => {
    expect(designSource).toContain("**Empty states**");
    expect(designSource).toContain("EmptyState");
    expect(designSource).toContain('No results for "<query>"');
    expect(designSource).toContain('Never "You\'re caught up" for a query miss');
    expect(designSource).toContain("**Clear search**");
  });

  test("shared empty-state CSS uses the title token and a 320px max width", () => {
    expect(css).toContain(".empty-state {");
    expect(css).toContain("max-width: 320px");
    expect(css).toContain("var(--text-title)");
  });
});
