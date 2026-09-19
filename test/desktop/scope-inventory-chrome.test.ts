import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const liveStateSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/LiveStatePanel.tsx"),
  "utf8",
);
const appSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/App.tsx"),
  "utf8",
);
const addModalSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/ScopeAddToProfileModal.tsx"),
  "utf8",
);
const designSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/DESIGN.md"),
  "utf8",
);
const stylesSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/styles.css"),
  "utf8",
);
const tabsSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/components/ResourceTypeTabs.tsx"),
  "utf8",
);

describe("Global/Project scope inventory chrome", () => {
  it("kills the two-column cockpit and keeps rail Apply as the sole Apply CTA", () => {
    expect(liveStateSource).not.toContain("live-state-columns");
    expect(liveStateSource).not.toContain("live-state-left-stack");
    expect(appSource).toContain("rail-apply-action");
    expect(appSource).not.toContain("status-cta");
    expect(designSource).toContain("sidebar only");
    expect(designSource).toContain("sole profile-apply CTA");
  });

  it("swaps main content to Target preview from Preview changes", () => {
    expect(appSource).toContain('label="Preview changes"');
    expect(appSource).toContain("FileDiff");
    expect(appSource).not.toMatch(/label="Preview changes"[\s\S]{0,200}<Eye /);
    expect(liveStateSource).toContain("previewChanges");
    expect(liveStateSource).toContain("onClosePreview");
    expect(liveStateSource).toContain('label="Close preview"');
    expect(liveStateSource).toContain('aria-label="Target preview"');
    expect(liveStateSource).not.toMatch(
      /<details[\s\S]{0,80}aria-label="Target preview"/,
    );
    expect(designSource).toContain("swaps main content");
    expect(designSource).toContain("FileDiff");
    expect(designSource).not.toContain(
      "Target preview is a collapsible apply-delta block in the same pane",
    );
  });

  it("uses one full-span search and wide type tabs with empty types disabled", () => {
    expect(liveStateSource).toContain('label="Filter resources"');
    expect(liveStateSource).toContain("emptyMode=\"disable\"");
    expect(liveStateSource).toContain("includeAll={true}");
    expect(liveStateSource).toContain("attention={inventoryAttention}");
    expect(liveStateSource).toContain("collectTypeTabAttention");
    expect(liveStateSource).toContain("searchFilteredInventory");
    expect(liveStateSource).toContain("countInventoryTypeTabs(searchFilteredInventory)");
    expect(liveStateSource).not.toContain("countInventoryTypeTabs(inventoryItems)");
    expect(liveStateSource).not.toContain("countResourceTypeTabs(inventoryItems");
    expect(tabsSource).toContain("resource-type-tab-attention");
    expect(stylesSource).toContain(".resource-type-tab-attention");
    expect(stylesSource).not.toContain("resource-type-tab-attention-fill");
    expect(liveStateSource).not.toContain('aria-label="Profile resources"');
    expect(liveStateSource).not.toContain('aria-label="Not staged"');
    expect(designSource).toContain("filters type-tab counts, attention dots, and every section");
    expect(designSource).toContain("Plugin pins share the **Plugins** tab");
    expect(designSource).toContain("Plugin refs hide when empty");
    expect(designSource).toContain("amber attention dot");
    expect(designSource).toContain("N to add · M inactive");
  });

  it("renders Not in profile, Inactive, then Active with filtered section actions", () => {
    expect(liveStateSource).toContain("Not in profile");
    expect(liveStateSource).toContain("Inactive");
    expect(liveStateSource).toContain("Active");
    expect(liveStateSource).toContain("inventorySectionTitle");
    expect(liveStateSource).toContain("PROFILE_INVENTORY_SECTION_ORDER");
    expect(liveStateSource).toContain("CircleDashed");
    expect(liveStateSource).toContain("CirclePause");
    expect(liveStateSource).toContain("CircleCheck");
    expect(liveStateSource).toContain("inventory-section-count");
    expect(liveStateSource).toContain('title="View changes"');
    expect(liveStateSource).toContain('label="Add all"');
    expect(liveStateSource).toContain('label="Activate all"');
    expect(liveStateSource).toContain('label="Add"');
    expect(liveStateSource).toContain('label="Activate"');
    expect(liveStateSource).toContain("primary={!railPrimaryIsReapply}");
    expect(designSource).toContain("Ghost **Add all**");
  });

  it("enters edit mode from the header pencil and exits with Done", () => {
    expect(appSource).toContain("inventoryEditMode");
    expect(appSource).toContain("live-toolbar-identity");
    expect(appSource).toContain("live-toolbar-actions");
    expect(appSource).toContain('label={inventoryEditMode ? "Done" : "Edit"}');
    expect(liveStateSource).toContain("editMode");
    expect(liveStateSource).toContain("profile-resource-remove-btn");
    expect(liveStateSource).toContain("Remove from profile");
    expect(liveStateSource).toContain("inventory-row-lead");
    expect(liveStateSource).toContain("inventory-row-remove-slot");
    expect(liveStateSource).toContain("inventory-row-remove-placeholder");
    expect(liveStateSource).toContain("inventory-row-icon");
    expect(stylesSource).toContain(".inventory-row-lead");
    expect(stylesSource).toContain(".inventory-row-remove-slot");
    expect(stylesSource).toContain("width: var(--icon-action-size)");
    const leadStart = stylesSource.indexOf("\n.inventory-row-lead {");
    expect(leadStart).toBeGreaterThan(-1);
    const leadBlock = stylesSource.slice(
      leadStart,
      stylesSource.indexOf("}", leadStart) + 1,
    );
    expect(leadBlock).toContain("display: inline-flex;");
    expect(leadBlock).toContain("align-items: center;");
    expect(leadBlock).not.toContain("flex-direction: column;");
    expect(stylesSource).toContain(".resource-row.inventory-row");
    expect(designSource).toContain("trash-width trailing slot");
    expect(designSource).toContain("status · type icon · name");
    expect(appSource).not.toMatch(
      /status-edit-action[\s\S]{0,200}openEditProfile\(selectedProfile\)/,
    );
  });

  it("keeps a FAB that opens pick-from-library and Create for the library flow", () => {
    expect(liveStateSource).toContain('data-testid="scope-inventory-fab"');
    expect(liveStateSource).toContain('aria-label="Add to profile"');
    expect(liveStateSource).toContain("ScopeAddToProfileModal");
    expect(addModalSource).toContain('label="Create"');
    expect(addModalSource).toContain("Checkbox");
    expect(addModalSource).toContain("dialog-header-actions");
    expect(addModalSource).toContain("type={type}");
    expect(addModalSource).toContain("resource-row-checkbox");
    expect(addModalSource).not.toMatch(
      /ResourceRowLeading[\s\S]{0,400}<TypeIcon/,
    );
    const headerStart = stylesSource.indexOf("\n.scope-add-modal .dialog-header {");
    expect(headerStart).toBeGreaterThan(-1);
    const headerBlock = stylesSource.slice(
      headerStart,
      stylesSource.indexOf("}", headerStart) + 1,
    );
    expect(headerBlock).toContain("display: flex;");
    expect(headerBlock).toContain("flex-direction: row;");
    expect(headerBlock).toContain("align-items: center;");
    expect(headerBlock).not.toContain("flex-direction: column;");
    expect(designSource).toContain("checkbox | type icon | name");
    expect(designSource).toContain("same header row");
    expect(addModalSource).not.toContain('density="compact"');
    expect(addModalSource).not.toContain("density=");
    expect(addModalSource).not.toContain("resource-type-tabs-compact");
    expect(addModalSource).not.toContain("wide");
    expect(addModalSource).toContain('overflow="collapse"');
    expect(addModalSource).toContain('emptyMode="hide"');
    expect(tabsSource).toContain('overflow = "wrap"');
    expect(tabsSource).toContain("collapsedTypeTabFit");
    expect(tabsSource).toContain("typeTabsMoreLabel");
    expect(tabsSource).toContain("TYPE_TABS_LESS_LABEL");
    expect(tabsSource).toContain("resource-type-tabs-more");
    expect(tabsSource).toContain("resource-type-tabs-less");
    expect(tabsSource).toContain("{expanded ? null : overflowControl}");
    expect(tabsSource).toContain("{expanded ? overflowControl : null}");
    expect(tabsSource).toContain("resource-type-tab-count");
    expect(tabsSource).toContain("resource-type-tab-label");
    expect(tabsSource).not.toContain('density="compact"');
    expect(liveStateSource).toMatch(/scope-inventory-pane[\s\S]*\bwide\b/);
    expect(designSource).toContain("Do not pass `density=\"compact\"`");
    expect(designSource).toContain("collapsed to one row");
    expect(designSource).toContain("`N more`");
    expect(designSource).toContain("`Less`");
    expect(designSource).toContain("end of the collapsed row");
    expect(designSource).toContain("right-aligned below the wrapping pills");
    expect(designSource).toContain("taller fixed-height dialog");
    const modalStart = stylesSource.indexOf("\n.scope-add-modal {");
    expect(modalStart).toBeGreaterThan(-1);
    const modalBlock = stylesSource.slice(
      modalStart,
      stylesSource.indexOf("}", modalStart) + 1,
    );
    expect(modalBlock).toContain("height: min(48rem, calc(100vh - 2rem));");
    expect(modalBlock).toContain("max-height: min(48rem, calc(100vh - 2rem));");
    expect(modalBlock).toContain("overflow: hidden;");
    expect(modalBlock).not.toContain("height: auto;");
    const listStart = stylesSource.indexOf("\n.scope-add-modal-list {");
    expect(listStart).toBeGreaterThan(-1);
    const listBlock = stylesSource.slice(
      listStart,
      stylesSource.indexOf("}", listStart) + 1,
    );
    expect(listBlock).toContain("flex: 1 1 auto;");
    expect(listBlock).toContain("overflow-y: auto;");
    const collapsedStart = stylesSource.indexOf(
      "\n.resource-type-tabs-collapsed .resource-type-tabs-scroller {",
    );
    expect(collapsedStart).toBeGreaterThan(-1);
    const collapsedBlock = stylesSource.slice(
      collapsedStart,
      stylesSource.indexOf("}", collapsedStart) + 1,
    );
    expect(collapsedBlock).toContain("flex-wrap: nowrap");
    expect(collapsedBlock).toContain("overflow: hidden");
    expect(collapsedBlock).not.toContain("display: none");
    const moreStart = stylesSource.indexOf("\n.resource-type-tabs-more {");
    expect(moreStart).toBeGreaterThan(-1);
    const moreBlock = stylesSource.slice(
      moreStart,
      stylesSource.indexOf("}", moreStart) + 1,
    );
    expect(moreBlock).not.toContain("min-width: 32px");
    expect(moreBlock).toContain("background: transparent");
    expect(moreBlock).not.toContain("margin-left: auto");
    const lessStart = stylesSource.indexOf(
      "\n.resource-type-tabs-expanded .resource-type-tabs-less {",
    );
    expect(lessStart).toBeGreaterThan(-1);
    const lessBlock = stylesSource.slice(
      lessStart,
      stylesSource.indexOf("}", lessStart) + 1,
    );
    expect(lessBlock).toContain("margin-left: auto");
    expect(lessBlock).toContain("margin-top:");
    expect(lessBlock).toContain("margin-bottom:");
    expect(lessBlock).toContain("padding:");
    expect(addModalSource).toContain("dialog-actions");
    expect(addModalSource).toContain("selectedCount < 1");
    expect(addModalSource).toMatch(/\n\s*Add\n\s*<\/button>/);
    expect(addModalSource).toContain("Cancel");
    expect(liveStateSource).toContain("ResourceTypeModal");
    expect(liveStateSource).toContain("ResourceCreatePanel");
    expect(designSource).toContain("Library create flow");
    expect(liveStateSource).toContain("scope-inventory-scroll");
    const fabStart = stylesSource.indexOf("\n.scope-inventory-fab {");
    expect(fabStart).toBeGreaterThan(-1);
    const fabBlock = stylesSource.slice(
      fabStart,
      stylesSource.indexOf("}", fabStart) + 1,
    );
    expect(fabBlock).toContain("position: absolute;");
    expect(fabBlock).toContain("right: 0.75rem;");
    expect(fabBlock).toContain("bottom: 0.75rem;");
    expect(fabBlock).not.toContain("position: sticky;");
    expect(designSource).toContain("over scrolling content");
  });

  it("opens inventory plugin package rows in Library plugin details by name", () => {
    expect(liveStateSource).toContain("profileInventoryOpenTarget");
    expect(liveStateSource).toContain("onOpenPlugin?.(target.name)");
    expect(liveStateSource).not.toMatch(
      /InventoryRow[\s\S]{0,400}onOpen=\{\(\) => onOpenResource\(resourceDetailTarget\(item\.resource\)\)\}/,
    );
    const livePanel = appSource.slice(appSource.indexOf("<LiveStatePanel"));
    expect(livePanel).toContain("onOpenPlugin={(pluginName) => {");
    expect(livePanel).toContain("setLibraryFocusPlugin(pluginName)");
    expect(livePanel).toContain('navigateToDestination("library")');
    expect(designSource).toContain(
      "Clicking a plugin package membership row opens Library plugin details",
    );
  });
});
