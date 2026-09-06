import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const root = join(import.meta.dir, "../../apps/desktop/src");
const createSource = readFileSync(
  join(root, "components/ResourceCreatePanel.tsx"),
  "utf8",
);
const compositionSource = readFileSync(
  join(root, "components/CompositionPickers.tsx"),
  "utf8",
);
const stylesSource = readFileSync(join(root, "styles.css"), "utf8");
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);

describe("create plugin compose picker", () => {
  test("reuses the profile Resources picker instead of a flat checkbox list", () => {
    expect(createSource).toContain("ResourceSelectionList");
    expect(createSource).toContain('title="Compose from library"');
    expect(createSource).toContain("onFilterChange={setResourceFilter}");
    expect(createSource).not.toContain("resource-picker-row");
    expect(createSource).not.toContain("pickerGroups");
    expect(compositionSource).toContain('placeholder="Filter (skill:name)…"');
    expect(compositionSource).toContain("selection-type-count");
    expect(compositionSource).toContain("toggleGroup");
  });

  test("keeps compose selection wired to plugin create attachments", () => {
    expect(createSource).toContain("selectedIds.has(resource.id)");
    expect(createSource).toContain("selector: resourceSelector(resource)");
    expect(createSource).toContain("createLibraryPlugin");
  });

  test("documents the shared picker and drops unused flat-list chrome", () => {
    expect(designSource).toContain(
      "Plugin create **Compose from library** reuses the profile Resources picker",
    );
    expect(stylesSource).toContain(".resource-create-compose .selection-list-rows");
    expect(stylesSource).not.toContain(".resource-picker-group");
    expect(stylesSource).not.toContain(".resource-picker-row");
  });
});
