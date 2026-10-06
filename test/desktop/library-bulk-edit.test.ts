import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  LIBRARY_BULK_DELETE_PREVIEW,
  libraryBulkDeleteLine,
  libraryBulkDeleteShowAllLabel,
  libraryBulkDeleteVisibleCount,
  pruneSelectedIds,
  selectAllCheckboxState,
  toggleSelectAllVisible,
} from "../../apps/desktop/src/lib/library-bulk-edit.ts";
import { readDesktopCss } from "./helpers/desktop-css.ts";

const panelSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/ResourcesPanel.tsx",
  ),
  "utf8",
);
const listSource = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/library/LibraryResourceList.tsx",
  ),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);
const stylesSource = readDesktopCss();

function sliceBetween(
  source: string,
  startNeedle: string,
  endNeedle: string,
): string {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start === -1 ? 0 : start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const headerRow = sliceBetween(
  panelSource,
  'className="resources-panel-header-row"',
  "resources-panel-layout",
);

describe("library bulk-edit selection", () => {
  test("select-all toggles only ids currently in the filtered list", () => {
    const visible = ["a", "b"];
    const withHidden = toggleSelectAllVisible(visible, new Set(["hidden"]));
    expect([...withHidden].sort()).toEqual(["a", "b", "hidden"]);

    const afterDeselect = toggleSelectAllVisible(visible, withHidden);
    expect([...afterDeselect]).toEqual(["hidden"]);
  });

  test("select-all checkbox is indeterminate when some visible rows are checked", () => {
    expect(selectAllCheckboxState(["a", "b"], new Set(["a"]))).toBe(
      "indeterminate",
    );
    expect(selectAllCheckboxState(["a", "b"], new Set(["a", "b"]))).toBe(true);
    expect(selectAllCheckboxState(["a", "b"], new Set(["hidden"]))).toBe(false);
  });

  test("leaving edit mode is implemented by clearing selection", () => {
    expect(panelSource).toContain("setLibraryEditMode");
    expect(panelSource).toContain("setSelectedIds(new Set())");
    expect(panelSource).toMatch(/function setLibraryEditMode[\s\S]*setSelectedIds\(new Set\(\)\)/);
  });

  test("prunes selection when rows leave the library", () => {
    expect([...pruneSelectedIds(new Set(["keep", "gone"]), new Set(["keep"]))]).toEqual([
      "keep",
    ]);
  });
});

describe("library bulk-edit chrome", () => {
  test("header uses a non-primary edit toggle and no Create resource plus", () => {
    expect(headerRow).toContain('data-testid="library-edit-mode"');
    expect(headerRow).toContain('label={libraryEditMode ? "Done" : "Edit"}');
    expect(headerRow).toContain("aria-pressed={libraryEditMode}");
    expect(headerRow).not.toContain('data-testid="library-create-resource"');
    expect(headerRow).not.toContain('label="Create resource"');
    expect(headerRow).not.toContain("primary");
    expect(headerRow).toContain("Pencil");
  });

  test("sticky FAB swaps add for destructive delete in edit mode", () => {
    expect(panelSource).toContain('data-testid="library-list-fab"');
    expect(panelSource).toContain('aria-label={');
    expect(panelSource).toContain('libraryEditMode ? "Delete selected" : "Add resource"');
    expect(panelSource).toContain("scope-inventory-fab");
    expect(panelSource).toContain('libraryEditMode ? "destructive" : "primary"');
    expect(panelSource).toContain("Trash2");
    expect(stylesSource).toContain(".icon-action.destructive");
    expect(stylesSource).toContain(".library-list-pane");
  });

  test("edit mode puts a checkbox on every row before the in-use mark", () => {
    expect(listSource).toContain("libraryEditMode");
    expect(listSource).toContain("resource-row-checkbox");
    expect(listSource).toContain("data-testid={`library-row-select-${entry.id}`}");
    expect(listSource).toContain("library-row-shell");
    const checkboxIdx = listSource.indexOf("library-row-select-${entry.id}");
    const optionIdx = listSource.indexOf('role="option"', checkboxIdx);
    const markIdx = listSource.indexOf("<InUseMark", checkboxIdx);
    expect(checkboxIdx).toBeGreaterThan(-1);
    expect(optionIdx).toBeGreaterThan(checkboxIdx);
    expect(markIdx).toBeGreaterThan(optionIdx);
  });

  test("select-all checkbox sits before the type tabs", () => {
    expect(panelSource).toContain('data-testid="library-select-all"');
    expect(panelSource).toContain("library-list-toolbar");
    const toolbar = sliceBetween(
      panelSource,
      "library-list-toolbar",
      "<ResourceTypeTabs",
    );
    expect(toolbar).toContain("library-select-all");
  });
});

describe("library bulk-delete confirm", () => {
  test("lists type plus name and caps the first page at 5", () => {
    expect(LIBRARY_BULK_DELETE_PREVIEW).toBe(5);
    expect(libraryBulkDeleteLine("Skills", "ripwire-find-bug")).toBe(
      "Skills ripwire-find-bug",
    );
    expect(libraryBulkDeleteVisibleCount(12, 0)).toBe(5);
    expect(libraryBulkDeleteVisibleCount(3, 0)).toBe(3);
    expect(libraryBulkDeleteVisibleCount(12, 10)).toBe(10);
    expect(libraryBulkDeleteShowAllLabel(12)).toBe("Show all (12)");
    expect(panelSource).toContain("libraryBulkDeleteShowAllLabel");
    expect(panelSource).toContain("Show more");
    expect(panelSource).toContain('tone="destructive"');
    expect(panelSource).toContain("deleteLibraryResource");
    expect(panelSource).toContain("deleteLibraryPlugin");
  });
});

describe("library bulk-edit design lock", () => {
  test("documents header edit, list FAB, and bulk delete confirm", () => {
    expect(designSource).toContain("icon-only **Edit**");
    expect(designSource).toContain("sticky **Add resource** FAB");
    expect(designSource).toContain("red trash");
    expect(designSource).toContain("Show all (N)");
    expect(designSource).not.toContain("icon-only **Create resource** (accent)");
  });
});
