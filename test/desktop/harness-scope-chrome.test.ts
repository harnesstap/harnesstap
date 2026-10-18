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
  it("shows the name and a quiet hint circle; tools change only through Tools", () => {
    expect(inventoryRow).toContain("inventory-chip-hint");
    expect(inventoryRow).toContain("aria-describedby={harnessLabel ? harnessTextId : undefined}");
    expect(inventoryRow).toContain("inventory-chip-actions");
    expect(control).toContain("harness-tools-action");
    expect(control).toContain('tooltip: "Choose tools"');
    expect(control).toContain("Wrench");
    expect(control).not.toContain("harness-scope-cluster");
    expect(control).not.toContain('id="?"');
    expect(css).toContain(".inventory-chip-hint");
    expect(css).not.toContain(".harness-scope-cluster");
    expect(css).not.toContain(".harness-scope-all-action");
    expect(css).not.toContain("bulk-scope");
  });

  it("uses locked copy without em dashes", () => {
    expect(copy).toContain("SCOPE_COPY.useOn");
    expect(copy).toContain("SCOPE_COPY.selectAll");
    expect(copy).toContain("SCOPE_COPY.none");
    expect(copy).toContain('filterPlaceholder: "Filter harnesses"');
    expect(copy).toContain("SCOPE_COPY.emptyHint");
    expect(srcScope).toContain("These read the same folder, so they share one setting");
    expect(copy).toContain("SCOPE_COPY.allTooltip");
    expect(copy).toContain("SCOPE_COPY.orphanedTooltip");
    expect(copy).toContain("alsoUseOnLabel");
    expect(copy).toContain("notNow: SCOPE_COPY.notNow");
    expect(copy).toContain("portableMcpTooltip");
    expect(copy).toContain("Harnesses for ${resourceName}");
    expect(copy).toContain("formatHarnessList");
    expect(copy).toContain("subsetScopeLine");
    expect(copy).not.toContain("—");
    expect(control).not.toContain("—");
  });

  it("sorts Use-on rows A to Z with no Main badge and treats missing as All", () => {
    expect(copy).toContain("parseStoredHarnessScope");
    expect(copy).toContain("a.name.localeCompare(b.name)");
    expect(control).toContain("sortHarnessOptions(");
    expect(control).not.toContain("mainId");
    expect(control).not.toContain("harness-scope-main");
    expect(copy).not.toContain("mainTooltip");
    expect(css).not.toContain(".harness-scope-main");
  });

  it("filters when more than 8 harnesses and refuses to uncheck the last one", () => {
    expect(control).toContain("FILTER_THRESHOLD = 8");
    expect(control).toContain("uncheckHarnessGroup(draftIds, group.harnessIds)");
    expect(control).toContain("LAST_TOOL_HINT");
    expect(control).not.toContain("HARNESS_SCOPE_COPY.none");
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
    expect(shots).toContain("risky-removal-dialog");
    expect(shots).toContain("file-change-groups");
    expect(shots).toContain('page.goto("about:blank"');
    expect(shots).toContain("SHOTS_BASE_URL");
    expect(gallery).toContain("<main");
    expect(gallery).toContain("harness-scope-gallery");
    expect(gallery).toContain('item("notes"');
    expect(gallery).toContain('"tooltip"');
    expect(gallery).toContain('"suggestion"');
    expect(gallery).not.toContain("everywhere");
    expect(gallery).not.toContain("All at rest");
    expect(gallery).toContain("At rest");
    expect(control).toContain('role="group"');
    expect(control).toContain("TOOLS_COPY.title");
    expect(control).not.toContain('role="listbox"');
  });
});
