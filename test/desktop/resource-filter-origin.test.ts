import { readFileSync, readdirSync } from "node:fs";
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

const compositionSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/CompositionPickers.tsx",
  ),
  "utf8",
);
const liveStateSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/LiveStatePanel.tsx"),
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
    expect(sidebarSource).toContain("Updated");
    expect(sidebarSource).toContain("Namespace");
    expect(sidebarSource).toContain("Origin");
    expect(sidebarSource).not.toContain("resource-filter-type-badge");
    expect(sidebarSource).not.toContain("resource-filter-type-badges");
    expect(sidebarSource).not.toContain("libraryFilterTypeLabel");
    expect(sidebarSource).not.toContain('aria-label="Resource type"');
    expect(sidebarSource).not.toMatch(/section-label">Type</);
    expect(panelSource).toContain("ResourceTypeTabs");
    expect(panelSource).not.toContain("resources-type-heading");
  });

  test("ResourceTypeTabs surfaces have no leftover Type chip filter UI", () => {
    expect(stylesSource).not.toContain("resource-filter-type-badge");
    expect(designSource).toContain("one type control");
    expect(designSource).toContain("Leftover TYPE chips are a bug");
    expect(compositionSource).toContain("ResourceTypeTabs");
    expect(compositionSource).not.toContain("selection-type-heading");
    expect(compositionSource).not.toContain("resource-filter-type-badge");
    expect(liveStateSource).toContain("ResourceTypeTabs");
    expect(liveStateSource).not.toContain("resource-filter-type-badge");

    const srcRoot = join(import.meta.dir, "../../apps/desktop/src");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) {
          continue;
        }
        const source = readFileSync(full, "utf8");
        if (source.includes("resource-filter-type-badge")) {
          offenders.push(full.slice(srcRoot.length + 1));
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });

  test("styles ResourceTypeTabs as filled selected pills", () => {
    expect(cssBlock(stylesSource, ".resource-type-tab")).toContain("min-height: 32px");
    expect(cssBlock(stylesSource, ".resource-type-tab")).toContain("min-width: 32px");
    expect(cssBlock(stylesSource, ".resource-type-tabs[data-compact=\"true\"] .resource-type-tab-face")).toContain(
      "min-width: 32px",
    );
    expect(cssBlock(stylesSource, '.resource-type-tab[data-state="on"]')).toContain(
      "background: var(--accent)",
    );
    expect(tabsSource).toContain("visibleResourceTypeTabs");
    expect(tabsSource).toContain("resourceTypeTabTooltip");
    expect(tabsSource).toContain("resourceTypeTabShowsCompactBadge");
    expect(tabsSource).toContain("resourceTypeTabGlyph");
    expect(tabsSource).not.toContain("RESOURCE_TYPE_TABS_WIDE_MIN_PX");
    expect(tabsSource).not.toContain("hostPaneWidth");
    expect(tabsSource).toContain('density = "pills"');
    expect(tabsSource).toContain("data-density={density}");
    expect(tabsSource).toContain("aria-label={caption}");
    expect(tabsSource).toContain("resource-type-tab-count");
    expect(tabsSource).toContain("resource-type-tab-badge");
    expect(tabsSource).toContain("ChromeTooltip");
    expect(tabsSource).toContain("content={caption}");
    expect(tabsSource).not.toContain("Sparkles");
    expect(tabsSource).toContain("TypeIcon");
    expect(cssBlock(stylesSource, ".resource-type-tabs")).toContain("width: 100%");
    expect(cssBlock(stylesSource, ".resource-type-tab-badge")).toContain("color: var(--muted)");
    expect(cssBlock(stylesSource, ".resource-type-tab-badge")).toContain("display: none");
    expect(
      cssBlock(stylesSource, '.resource-type-tabs[data-compact="true"] .resource-type-tab-badge'),
    ).toContain("display: inline-flex");
    expect(
      cssBlock(stylesSource, '.resource-type-tab[data-state="on"] .resource-type-tab-badge'),
    ).toContain("background: var(--primary-foreground)");
    expect(
      cssBlock(stylesSource, '.resource-type-tab[data-state="on"] .resource-type-tab-badge'),
    ).toContain("color: var(--accent)");
    expect(
      cssBlock(stylesSource, '.resource-type-tab[data-state="on"] .resource-type-tab-badge'),
    ).not.toContain("display: none");
    expect(stylesSource).not.toContain("@container (min-width: 900px)");
    expect(
      cssBlock(stylesSource, '.resource-type-tabs[data-density="pills"] .resource-type-tabs-scroller'),
    ).toContain("flex-wrap: wrap");
    expect(
      cssBlock(stylesSource, '.resource-type-tabs[data-density="pills"] .resource-type-tabs-scroller'),
    ).not.toContain("overflow-x: auto");
    expect(designSource).toContain("ResourceTypeTabs");
    expect(designSource).toContain("No sidebar Type chips");
    expect(designSource).toContain("Two densities via `density`");
    expect(designSource).toContain('(`pills` | `compact`)');
    expect(designSource).toContain("never collapse to icon-only");
    expect(designSource).toContain("Prefer **pills** unless the shell is clearly narrow");
    expect(designSource).toContain("1 Skills");
    expect(designSource).toContain("2 Plugins");
    expect(designSource).toContain("Compact count badge");
    expect(designSource).toContain("1 skill");
    expect(designSource).toContain("badge-only");
    expect(designSource).toContain("Pills always have icons");
    expect(designSource).toContain("crush the list");
    expect(designSource).toContain("never plugin, plugin ref, package, or instruction");
    expect(designSource).toContain("Profile resources use the same ResourceTypeTabs over a flat list");
    expect(designSource).toContain("Profile resources omits All");
  });

  test("pills density keeps icon, count, and type text without icon-only collapse", () => {
    expect(tabsSource).toContain('density = "pills"');
    expect(tabsSource).toContain("const pills = density === \"pills\"");
    expect(tabsSource).toContain("const compact = density === \"compact\"");
    expect(tabsSource).not.toContain("ResizeObserver");
    expect(tabsSource.indexOf("resource-type-tab-count")).toBeLessThan(
      tabsSource.lastIndexOf("resource-type-tab-label"),
    );
    const pillsStart = tabsSource.indexOf("{pills ? (");
    expect(pillsStart).toBeGreaterThan(-1);
    const pillsBranch = tabsSource.slice(
      pillsStart,
      tabsSource.indexOf(") : null}", pillsStart),
    );
    expect(pillsBranch.indexOf("resource-type-tab-count")).toBeLessThan(
      pillsBranch.indexOf("resource-type-tab-label"),
    );
    expect(pillsBranch).toContain("resource-type-tab-count");
    expect(pillsBranch).toContain("resource-type-tab-label");
    expect(panelSource).toContain('density="pills"');
    expect(compositionSource).toContain('density="pills"');
    const profileResources = liveStateSource.slice(
      liveStateSource.indexOf('aria-label="Profile resources"'),
      liveStateSource.indexOf('aria-label="Not staged"'),
    );
    const notStaged = liveStateSource.slice(
      liveStateSource.indexOf('aria-label="Not staged"'),
    );
    expect(notStaged).toContain('density="pills"');
    expect(profileResources).toContain('density="pills"');
    expect(profileResources).not.toContain('density="compact"');
    const typeBadges = liveStateSource.slice(
      liveStateSource.indexOf("function TargetPreviewTypeBadges"),
      liveStateSource.indexOf("function stackChangeToneIcon"),
    );
    expect(typeBadges).toContain('data-density="pills"');
    expect(typeBadges).toContain("apply-diff-type-badge-label");
    expect(typeBadges).toContain("resourceTypeTabLabel(type)");
    expect(typeBadges).toContain("resourceTypeTabTooltip");
    expect(typeBadges).not.toContain("ChromeTooltip");
    expect(designSource).toContain("**pills**");
    expect(designSource).toContain("**compact**");
    expect(designSource).toContain("Default pills density");
    expect(designSource).toContain("Library, Profile resources, Not staged");
    expect(designSource).toContain("not Profile resources");
    expect(designSource).toContain(
      "at pills density (icon, then count, then type text; wrap; never compact)",
    );
  });

  test("Library keeps the All tab; Profile resources omits it", () => {
    expect(tabsSource).toContain("includeAll = true");
    expect(panelSource).toContain("<ResourceTypeTabs");
    expect(panelSource).not.toContain("includeAll={false}");
    expect(compositionSource).toContain("<ResourceTypeTabs");
    expect(compositionSource).not.toContain("includeAll={false}");
    const profileResources = liveStateSource.slice(
      liveStateSource.indexOf('aria-label="Profile resources"'),
      liveStateSource.indexOf('aria-label="Not staged"'),
    );
    const notStaged = liveStateSource.slice(
      liveStateSource.indexOf('aria-label="Not staged"'),
    );
    expect(profileResources).toContain("includeAll={false}");
    expect(notStaged).toContain("<ResourceTypeTabs");
    expect(notStaged).toContain('density="pills"');
    expect(notStaged).not.toContain("includeAll={false}");
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
