import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { inheritedItemKey } from "../../apps/desktop/src/lib/api/library-plugins.ts";
import {
  DETACH_CONFIRM_COPY,
  DUPLICATE_MODE_COPY,
  defaultDuplicateName,
  detachSuccessMessage,
  duplicateSuccessMessage,
  inheritedItemLabel,
  inheritedSummary,
  toggleExcludeEntry,
} from "../../apps/desktop/src/lib/duplicate-profile.ts";

const src = (path: string) =>
  readFileSync(join(import.meta.dir, "../../apps/desktop/src", path), "utf8");

describe("duplicate and keep in sync", () => {
  test("dialog copy names both modes and defaults to Keep in sync", () => {
    expect(DUPLICATE_MODE_COPY.inherit.label).toBe("Keep in sync");
    expect(DUPLICATE_MODE_COPY.inherit.hint).toBe("Parent updates show up here.");
    expect(DUPLICATE_MODE_COPY.copy.label).toBe("Separate copy");
    expect(src("components/DuplicateDialog.tsx")).toContain('useState<DuplicateMode>("inherit")');
    expect(defaultDuplicateName("backend")).toBe("backend-copy");
  });

  test("success messages say what was created", () => {
    expect(duplicateSuccessMessage("backend", { name: "mine", mode: "inherit" })).toBe(
      "Created mine, kept in sync with backend",
    );
    expect(duplicateSuccessMessage("backend", { name: "b2", mode: "copy" })).toBe(
      "Created b2 as a separate copy of backend",
    );
    expect(detachSuccessMessage("mine", { materialized: 1, hidden_cleared: [] })).toBe(
      "Detached mine. Copied 1 item from the parent.",
    );
  });

  test("detach confirm says nothing is deleted", () => {
    expect(DETACH_CONFIRM_COPY.description).toContain("Nothing is deleted.");
  });

  test("toggling an inherited item flips only that entry", () => {
    expect(toggleExcludeEntry([], "skill:deploy")).toEqual(["skill:deploy"]);
    expect(toggleExcludeEntry(["skill:deploy", "plugin:web"], "skill:deploy")).toEqual(["plugin:web"]);
    expect(inheritedItemKey({ type: "plugin", name: "web" })).toBe("plugin:web");
    expect(inheritedItemLabel({ type: "skill", name: "review" })).toBe("review (skill)");
    expect(inheritedItemLabel({ type: "plugin", name: "web" })).toBe("web");
  });

  test("library detail summarises inherited items", () => {
    expect(inheritedSummary([{ hidden: false }, { hidden: true }])).toBe("1 item, 1 hidden");
    expect(inheritedSummary([{ hidden: false }, { hidden: false }])).toBe("2 items");
    expect(inheritedSummary([], "Parent x is not installed.")).toBe("Parent not installed");
  });

  test("one Duplicate button replaces Fork in the plugin detail", () => {
    const detail = src("components/PluginPackageDetail.tsx");
    expect(detail).toContain('label="Duplicate"');
    expect(detail).not.toContain('label="Fork"');
    expect(detail).toContain("<DuplicateDialog");
  });

  test("edit pane shows inherited rows with a from parent chip and one Detach action", () => {
    const section = src("components/InheritedItemsSection.tsx");
    expect(section).toContain("from parent");
    expect(section).toContain("Detach from parent");
    const pane = src("components/EditProfilePane.tsx");
    expect(pane).toContain("<InheritedItemsSection");
    expect(pane).toContain('label: "Undo"');
    expect(pane).toContain("DETACH_CONFIRM_COPY");
  });

  test("publish drawer shows blockers and keeps Publish disabled", () => {
    const drawer = src("components/parity/PublishProfileDrawer.tsx");
    expect(drawer).toContain("blockers.length === 0");
    expect(drawer).toContain("blocker.message");
  });
});
