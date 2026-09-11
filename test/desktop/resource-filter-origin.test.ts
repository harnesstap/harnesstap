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
const tabsSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/ResourceTypeTabs.tsx",
  ),
  "utf8",
);
const panelSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/ResourcesPanel.tsx"),
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
  test("keeps name search without sidebar Type chips", () => {
    expect(sidebarSource).toContain('placeholder="Filter by name"');
    expect(sidebarSource).not.toContain("resource-filter-type-badge");
    expect(sidebarSource).not.toContain("libraryFilterTypeLabel");
    expect(panelSource).toContain("ResourceTypeTabs");
    expect(panelSource).not.toContain("resources-type-heading");
  });

  test("styles ResourceTypeTabs as filled selected pills", () => {
    const tab = cssBlock(stylesSource, ".resource-type-tab");
    expect(tab).toContain("min-height: 32px");
    expect(tab).toContain("border-radius: 999px");
    expect(cssBlock(stylesSource, '.resource-type-tab[data-state="on"]')).toContain(
      "background: var(--accent)",
    );
    expect(tabsSource).toContain("visibleResourceTypeTabs");
    expect(tabsSource).toContain("ChromeTooltip");
    expect(designSource).toContain("ResourceTypeTabs");
    expect(designSource).toContain("No sidebar Type chips");
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
