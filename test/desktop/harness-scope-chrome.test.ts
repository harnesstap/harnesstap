import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readDesktopCss } from "./helpers/desktop-css.ts";

const inventoryRow = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/live/InventoryRow.tsx"),
  "utf8",
);
const control = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/live/HarnessScopeControl.tsx"),
  "utf8",
);
const copy = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/lib/harness-scope-ui.ts"),
  "utf8",
);
const gallery = readFileSync(
  join(
    import.meta.dir,
    "../../apps/desktop/src/components/live/HarnessScopeVisualGallery.tsx",
  ),
  "utf8",
);
const shots = readFileSync(
  join(import.meta.dir, "../../apps/desktop/scripts/ui-shots.mjs"),
  "utf8",
);
const srcScope = readFileSync(
  join(import.meta.dir, "../../src/services/harness-scope.ts"),
  "utf8",
);
const css = readDesktopCss();

describe("harness scope desktop UX", () => {
  it("keeps All chrome in trailing actions and subset cluster after the name", () => {
    expect(inventoryRow).toContain("{subsetScope ? scopeControl : null}");
    expect(inventoryRow).toContain("{!subsetScope ? scopeControl : null}");
    expect(inventoryRow).toContain("inventory-chip-actions");
    expect(control).toContain("harness-scope-all-action");
    expect(control).toContain("harness-scope-cluster");
    expect(control).toContain("Cable");
    expect(css).toContain(".harness-scope-all-action");
    expect(css).toContain("opacity: 0");
    expect(css).toContain(".inventory-chip:hover .harness-scope-all-action");
    expect(css).toContain("gap: 2px");
    expect(css).toContain("border-radius: 4px");
    expect(css).toContain(".harness-scope-cluster.is-orphaned");
    expect(css).not.toContain("bulk-scope");
  });

  it("uses locked copy without em dashes", () => {
    expect(copy).toContain('useOn: "Use on"');
    expect(copy).toContain('selectAll: "Select all"');
    expect(copy).toContain('none: "None"');
    expect(copy).toContain('main: "Main"');
    expect(copy).toContain('filterPlaceholder: "Filter harnesses"');
    expect(copy).toContain('emptyHint: "Pick at least one harness"');
    expect(srcScope).toContain("These read the same folder, so they share one setting");
    expect(copy).toContain('allTooltip: "On all harnesses. Pick which ones"');
    expect(copy).toContain('orphanedTooltip: "Its harnesses are gone. Pick new ones"');
    expect(copy).toContain("Harnesses for ${resourceName}");
    expect(copy).toContain("Only on ${visible.join(\", \")}");
    expect(copy).toContain("and ${extra} more");
    expect(copy).not.toContain("—");
    expect(control).not.toContain("—");
  });

  it("sorts Main first then A to Z and treats missing as All", () => {
    expect(copy).toContain("parseStoredHarnessScope");
    expect(copy).toContain("option.id !== mainId");
    expect(copy).toContain("a.name.localeCompare(b.name)");
    expect(control).toContain("HARNESS_SCOPE_COPY.main");
  });

  it("filters when more than 8 harnesses and restores empty close", () => {
    expect(control).toContain("FILTER_THRESHOLD = 8");
    expect(control).toContain("HARNESS_SCOPE_COPY.emptyHint");
    expect(control).toContain("restoreRef");
    expect(control).toContain("draftIds.length === 0");
  });

  it("covers gallery row states in ui-shots", () => {
    expect(gallery).toContain("all-rest");
    expect(gallery).toContain("all-hover");
    expect(gallery).toContain("subset");
    expect(gallery).toContain("orphaned");
    expect(gallery).toContain("popover");
    expect(shots).toContain("harness-scope-all-rest");
    expect(shots).toContain("harness-scope-all-hover");
    expect(shots).toContain("harness-scope-subset");
    expect(shots).toContain("harness-scope-orphaned");
    expect(shots).toContain("harness-scope-popover");
    expect(shots).toContain('page.goto("about:blank"');
    expect(shots).toContain("SHOTS_BASE_URL");
    expect(gallery).toContain("<main");
    expect(gallery).toContain("harness-scope-gallery");
    expect(gallery).toContain('item("notes"');
    expect(gallery).not.toContain("everywhere");
    expect(gallery).not.toContain("All at rest");
    expect(gallery).toContain("At rest");
    expect(control).toContain('role="group"');
    expect(control).toContain("HARNESS_SCOPE_COPY.useOn");
    expect(control).not.toContain('role="listbox"');
  });
});
