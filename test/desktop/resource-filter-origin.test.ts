import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const sidebarSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/ResourceFilterSidebar.tsx",
  ),
  "utf8",
);
const stylesSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/styles.css"),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

function cssBlock(source: string, selector: string): string {
  const needle = `\n${selector} {`;
  const start = source.indexOf(needle);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("}", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 1);
}

describe("library origin filter chrome", () => {
  test("labels the plugin ref type badge explicitly", () => {
    expect(sidebarSource).toContain("libraryFilterTypeLabel(type)");
    expect(sidebarSource).toContain("libraryFilterType(resource)");
    expect(sidebarSource).toContain('placeholder="Filter by name"');
  });

  test("omits zero-count type chips unless that type is selected", () => {
    expect(sidebarSource).toContain("if (count === 0 && !on)");
    expect(sidebarSource).toContain("return null;");
    expect(sidebarSource).not.toContain("empty:not(.on)");
  });

  test("styles type chips as compact outline pills", () => {
    const chips = cssBlock(stylesSource, ".resource-filter-type-badge");
    expect(chips).toContain("background: transparent");
    expect(chips).toContain("font-size: 10px");
    expect(chips).toContain("padding: 0.05rem 0.32rem");
    expect(cssBlock(stylesSource, ".resource-filter-type-badge.on")).toContain(
      "color-mix(in srgb, var(--accent) 8%, transparent)",
    );
    expect(designSource).toContain("compact outline pills");
  });

  test("renders origin as a radio list, not a combobox", () => {
    expect(sidebarSource).toContain('name="resource-filter-origin"');
    expect(sidebarSource).toContain('type="radio"');
    expect(sidebarSource).toContain('id="resource-filter-namespace"');
    expect(sidebarSource).not.toContain('id="resource-filter-origin"');
  });

  test("styles origin radio options as selectable rows", () => {
    const option = cssBlock(stylesSource, ".resource-filter-option");
    expect(option).toContain("display: flex");
    expect(cssBlock(stylesSource, ".resource-filter-option.selected")).toContain(
      "border-color: var(--accent)",
    );
  });
});
