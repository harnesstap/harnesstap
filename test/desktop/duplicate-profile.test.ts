import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { inheritedItemKey } from "../../apps/desktop/src/lib/api/library-plugins.ts";
import {
  DETACH_UNDO_MS,
  defaultDuplicateName,
  detachedMessage,
  duplicateDialogTitle,
  duplicateModeCopy,
  duplicateNameError,
  duplicateSuccessMessage,
  inheritedItemLabel,
  inheritedRowTooltips,
  inheritedToggleMessage,
  parentNameFromRef,
  syncedChip,
  toggleExcludeEntry,
} from "../../apps/desktop/src/lib/duplicate-profile.ts";
import { editedTooltip } from "../../apps/desktop/src/components/EditedChip.tsx";
import { formatEditedLine } from "../../apps/desktop/src/lib/library-timestamp.ts";
import { libraryRowBadge } from "../../apps/desktop/src/lib/library-list.ts";

const src = (path: string) =>
  readFileSync(join(import.meta.dir, "../../apps/desktop/src", path), "utf8");

describe("duplicate dialog", () => {
  test("says profile, has no subtitle, and names both modes in plain words", () => {
    expect(duplicateDialogTitle(true)).toBe("Duplicate profile");
    expect(duplicateDialogTitle(false)).toBe("Duplicate plugin");
    const copy = duplicateModeCopy("backend");
    expect(copy.inherit).toEqual({
      label: "Add it to a new profile",
      hint: "The new profile contains backend and gets its updates. Hide anything you don't need.",
    });
    expect(copy.copy).toEqual({
      label: "Separate copy",
      hint: "Starts as a copy. Yours to change from here.",
    });
    const dialog = src("components/DuplicateDialog.tsx");
    expect(dialog).toContain('useState<DuplicateMode>("inherit")');
    expect(dialog).not.toContain("Library resources are shared");
    expect(defaultDuplicateName("backend")).toBe("backend-copy");
  });

  test("checks the name inline", () => {
    const taken = new Set(["backend", "backend-copy"]);
    expect(duplicateNameError("backend-copy", taken)).toBe("backend-copy already exists.");
    expect(duplicateNameError("  ", taken)).toBe("Enter a name.");
    expect(duplicateNameError("backend-team", taken)).toBeNull();
    expect(src("components/DuplicateDialog.tsx")).toContain("confirmDisabled={nameError !== null}");
  });

  test("success toast reads short and opens the profile", () => {
    expect(duplicateSuccessMessage("backend", { name: "backend-team", mode: "inherit" })).toBe(
      "backend-team created. Synced with backend.",
    );
    expect(duplicateSuccessMessage("backend", { name: "b2", mode: "copy" })).toBe(
      "b2 created. Separate copy of backend.",
    );
    expect(src("components/PluginPackageDetail.tsx")).toContain("onOpen: () => onOpenProfile(result.name)");
    expect(src("components/shell/ProfileHeaderActions.tsx")).toContain(
      "onOpen: () => ctrl.selectProfile(result.name)",
    );
  });

  test("is reachable from the profile page header too", () => {
    const header = src("components/shell/ProfileHeaderActions.tsx");
    expect(header).toContain("<DuplicateDialog");
    expect(header).toContain('data-testid="profile-duplicate"');
  });
});

describe("kept-in-sync profile", () => {
  test("inherited rows sit inline in Composition with a link or eye-off icon", () => {
    const picker = src("components/CompositionPickers.tsx");
    expect(picker).toContain("InheritedPickerRow");
    expect(picker).toContain("<EyeOff");
    expect(picker).toContain("<Link2");
    expect(inheritedRowTooltips({ hidden: false }, "backend")).toEqual({
      checkbox: "Hide from this profile",
      state: "From backend",
    });
    expect(inheritedRowTooltips({ hidden: true }, "backend").checkbox).toBe("Include");
    expect(src("components/EditProfilePane.tsx")).not.toContain("InheritedItemsSection");
    expect(src("components/PluginPackageDetail.tsx")).not.toContain('fieldName="From parent"');
  });

  test("header chip says what it is synced with", () => {
    expect(parentNameFromRef("acme/team/backend@^1.0.0")).toBe("backend");
    expect(parentNameFromRef("backend")).toBe("backend");
    expect(syncedChip({ ref: "backend", version_at_link: "1.0.0" }, "backend")).toEqual({
      label: "Synced with backend 1.0.0",
      tooltip: "Updates from backend show up here",
    });
  });

  test("hide toast is short, with Undo on the same line", () => {
    expect(inheritedToggleMessage("shared-skill", true)).toBe("shared-skill hidden");
    expect(inheritedToggleMessage("shared-skill", false)).toBe("shared-skill shown");
    expect(src("components/shell/ToastRegion.tsx")).toContain("toast-line");
  });

  test("detach runs at once and offers Undo instead of a confirm", () => {
    expect(detachedMessage("backend-qa", "backend")).toBe("backend-qa detached from backend.");
    expect(DETACH_UNDO_MS).toBe(10_000);
    for (const file of ["components/EditProfilePane.tsx", "components/PluginPackageDetail.tsx", "components/shell/ProfileHeaderActions.tsx"]) {
      const source = src(file);
      expect(source).toContain("undoDetachLibraryPlugin");
      expect(source).not.toContain("DETACH_CONFIRM_COPY");
    }
  });

  test("toggling an inherited item flips only that entry", () => {
    expect(toggleExcludeEntry([], "skill:deploy")).toEqual(["skill:deploy"]);
    expect(toggleExcludeEntry(["skill:deploy", "plugin:web"], "skill:deploy")).toEqual(["plugin:web"]);
    expect(inheritedItemKey({ type: "plugin", name: "web" })).toBe("plugin:web");
    expect(inheritedItemLabel({ type: "skill", name: "review" })).toBe("review (skill)");
  });
});

describe("header and version chrome", () => {
  test("Library detail drops Apply for profiles and shows the type as a chip", () => {
    const detail = src("components/PluginPackageDetail.tsx");
    expect(detail).toContain("Profiles apply from the sidebar only.");
    expect(detail).toContain('data-testid="library-detail-type"');
    expect(detail).not.toContain('typeLabel="plugin"');
    expect(detail).toContain("<OverflowMenu");
    expect(detail).toContain('label="Duplicate"');
    expect(detail).toContain("<DuplicateDialog");
  });

  test("Edited chip replaces the asterisk", () => {
    expect(editedTooltip("1.0.0")).toBe("Changed since 1.0.0 was tagged. Tag a version to keep these changes.");
    for (const file of ["components/PluginPackageDetail.tsx", "components/EditProfilePane.tsx", "components/shell/ScopeWorkspace.tsx", "components/PluginVersionHistoryList.tsx"]) {
      expect(src(file)).not.toContain('? "*" : ""');
    }
    expect(
      libraryRowBadge({ listKind: "plugin-package", version: "1.0.0", dirty: true } as Parameters<typeof libraryRowBadge>[0]),
    ).toBe("1.0.0 edited");
  });

  test("Edited line keeps the exact time for its tooltip", () => {
    const now = new Date("2026-10-17T10:00:30Z");
    const line = formatEditedLine("2026-10-17T10:00:00Z", { now });
    expect(line?.text).toBe("Edited just now");
    expect(line?.exact).toBeTruthy();
  });

  test("tooltips close on click so they do not linger after a dialog", () => {
    const tooltip = src("components/ChromeTooltip.tsx");
    expect(tooltip).toContain("suppressFocusOpen");
    expect(tooltip).toContain("onPointerDown");
  });

  test("publish drawer shows blockers and keeps Publish disabled", () => {
    const drawer = src("components/parity/PublishProfileDrawer.tsx");
    expect(drawer).toContain("blockers.length === 0");
    expect(drawer).toContain("blocker.message");
  });
});
