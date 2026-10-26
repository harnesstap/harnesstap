import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { appendProfileTags } from "../../apps/desktop/src/lib/profile-tags.ts";
import { resourceTypeTabUnit } from "../../apps/desktop/src/lib/resource-type-tabs.ts";

const src = (path: string) =>
  readFileSync(join(import.meta.dir, "../../apps/desktop/src", path), "utf8");

const header = src("components/shell/ProfileHeaderActions.tsx");
const workspace = src("components/shell/ScopeWorkspace.tsx");
const rail = src("components/shell/ProfilesRail.tsx");
const edit = src("components/EditProfilePane.tsx");
const live = src("components/LiveStatePanel.tsx");
const filterSidebar = src("components/ResourceFilterSidebar.tsx");
const resources = src("components/ResourcesPanel.tsx");
const scopeCss = src("styles/features/scope.css");

describe("profile header (P1-5)", () => {
  test("shows only Edit and History as icons, everything else in one overflow", () => {
    expect(header).toContain('data-testid="profile-edit"');
    expect(header).toContain('data-testid="profile-history"');
    expect(header).toContain('testId="profile-overflow"');
    const order = ['id: "duplicate"', 'id: "tag"', "...projectItems", 'id: "overwrite"', 'id: "publish"', 'id: "delete"'];
    const idx = order.map((needle) => header.indexOf(needle));
    for (const i of idx) expect(i).toBeGreaterThan(-1);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  test("project Install and History are overflow items, not toolbar icons", () => {
    expect(workspace).toContain('id: "project-install"');
    expect(workspace).toContain('id: "project-history"');
    expect(workspace).not.toContain('label="Preview changes"');
  });

  test("the rail has no per-row pencil and says file changes", () => {
    expect(rail).not.toContain("profile-item-edit");
    expect(rail).toContain('"file changes"');
    expect(scopeCss).not.toContain(".profile-item-edit");
  });
});

describe("one path per action (P1-6)", () => {
  test("Library filter sidebar has no funnel-x clear next to search", () => {
    expect(filterSidebar).not.toContain("resource-filter-clear");
    expect(filterSidebar).not.toContain("FilterX");
  });

  test("Library header drops Import and uses a non-refresh Update all glyph", () => {
    expect(resources).toContain("<CircleArrowUp");
  });
});

describe("composition add button (P1-4)", () => {
  test("sits on the Composition heading instead of a floating FAB", () => {
    expect(src("components/parity/PluginCompositionFields.tsx")).toContain('className="composition-heading"');
    expect(edit).toContain('data-testid="edit-profile-composition-add"');
    expect(src("styles/features/create.css")).not.toContain(".edit-profile-pane .scope-inventory-fab");
  });
});

describe("edit pane tags (P2-17)", () => {
  test("Tag a new version is an edit overflow item", () => {
    expect(edit).toContain('id: "tag"');
    expect(edit).toContain('label: "Tag a new version"');
  });

  test("typed tags append as pills, trimmed and deduplicated", () => {
    expect(appendProfileTags(["a"], " b, a ,, c ")).toEqual(["a", "b", "c"]);
    expect(appendProfileTags([], "profile")).toEqual([]);
    expect(edit).toContain('data-testid="edit-profile-tag-pills"');
    expect(edit).toContain('placeholder="Add a tag"');
  });
});

describe("target preview (P1-24)", () => {
  test("type badges use a counted unit", () => {
    expect(resourceTypeTabUnit("subagent", 1)).toBe("subagent");
    expect(resourceTypeTabUnit("subagent", 2)).toBe("subagents");
    expect(live).toContain("resourceTypeTabUnit(type, count)");
  });

  test("commit control is labeled and modified rows are neutral", () => {
    expect(live).toContain('label="Save edits to profile"');
    expect(scopeCss).toMatch(/\.file-change-kind-badge\.update\s*\{[^}]*var\(--fg\)/);
  });
});
