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
    expect(liveStateSource).not.toContain('aria-label="Profile resources"');
    expect(liveStateSource).not.toContain('aria-label="Not staged"');
    expect(designSource).toContain("No <type> found");
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
    expect(addModalSource).toContain("dialog-actions");
    expect(addModalSource).toContain("selectedCount < 1");
    expect(addModalSource).toMatch(/\n\s*Add\n\s*<\/button>/);
    expect(addModalSource).toContain("Cancel");
    expect(liveStateSource).toContain("ResourceTypeModal");
    expect(liveStateSource).toContain("ResourceCreatePanel");
    expect(designSource).toContain("Library create flow");
  });
});
