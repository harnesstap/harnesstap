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
