import { describe, expect, test } from "bun:test";
import {
  escapeAction,
  isOutsideLibraryDetail,
  libraryPaneHasPrevious,
  sidebarChangeAction,
} from "../../apps/desktop/src/lib/library-pane.ts";

describe("library pane navigation", () => {
  test("list has no local previous screen; detail does", () => {
    expect(libraryPaneHasPrevious({ mode: "list" })).toBe(false);
    expect(
      libraryPaneHasPrevious({
        mode: "detail",
        target: { kind: "plugin-package", selector: "eng" },
      }),
    ).toBe(true);
    expect(
      libraryPaneHasPrevious({
        mode: "detail",
        target: { kind: "resource", selector: "skill:ship", label: "ship" },
      }),
    ).toBe(true);
  });

  test("escape cancels field edit, dismisses confirm, otherwise leaves detail", () => {
    expect(escapeAction({ fieldEditing: true, confirmOpen: false })).toBe("cancel-field");
    expect(escapeAction({ fieldEditing: false, confirmOpen: true })).toBe("dismiss-confirm");
    expect(escapeAction({ fieldEditing: false, confirmOpen: false })).toBe("leave-pane");
  });

  test("sidebar changes block while busy or confirming, otherwise leave", () => {
    expect(sidebarChangeAction({ busy: true, confirmOpen: false })).toBe("block");
    expect(sidebarChangeAction({ busy: false, confirmOpen: true })).toBe("block");
    expect(sidebarChangeAction({ busy: false, confirmOpen: false })).toBe("leave-and-apply");
  });

  test("outside detection targets the library detail document", () => {
    expect(isOutsideLibraryDetail(null)).toBe(true);
    const inside = { closest: () => ({}) };
    expect(isOutsideLibraryDetail(inside)).toBe(false);
    const outside = { closest: () => null };
    expect(isOutsideLibraryDetail(outside)).toBe(true);
  });
});
