import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  isLibraryListNavKey,
  isLibraryTypeaheadChar,
  LIBRARY_TYPEAHEAD_MS,
  matchLibraryTypeahead,
  nextLibraryListIndex,
  shouldRestoreLibraryRowFocus,
} from "../../apps/desktop/src/lib/library-list-nav.ts";

describe("library list keyboard nav", () => {
  it("moves without wrapping and jumps Home/End", () => {
    expect(nextLibraryListIndex(0, "ArrowDown", 4)).toBe(1);
    expect(nextLibraryListIndex(3, "ArrowDown", 4)).toBe(3);
    expect(nextLibraryListIndex(0, "ArrowUp", 4)).toBe(0);
    expect(nextLibraryListIndex(2, "Home", 4)).toBe(0);
    expect(nextLibraryListIndex(1, "End", 4)).toBe(3);
    expect(isLibraryListNavKey("ArrowDown")).toBe(true);
    expect(isLibraryListNavKey("Enter")).toBe(false);
  });

  it("typeahead matches prefixes from the current index and wraps", () => {
    const labels = ["alpha", "beta", "ship", "skill"];
    expect(matchLibraryTypeahead(labels, "s", 0)).toBe(2);
    expect(matchLibraryTypeahead(labels, "sk", 2)).toBe(3);
    expect(matchLibraryTypeahead(labels, "a", 1)).toBe(0);
    expect(matchLibraryTypeahead(labels, "z", 0)).toBe(-1);
    expect(isLibraryTypeaheadChar("s")).toBe(true);
    expect(isLibraryTypeaheadChar("Enter")).toBe(false);
    expect(LIBRARY_TYPEAHEAD_MS).toBe(500);
  });

  it("does not steal focus from the filter when the last-opened row is still in the list", () => {
    const filter = { tagName: "INPUT", isContentEditable: false };
    expect(
      shouldRestoreLibraryRowFocus({ reason: "rows", activeElement: filter }),
    ).toBe(false);
    expect(
      shouldRestoreLibraryRowFocus({
        reason: "mount",
        activeElement: filter,
      }),
    ).toBe(false);
    expect(
      shouldRestoreLibraryRowFocus({
        reason: "last-selector",
        activeElement: filter,
      }),
    ).toBe(false);
  });

  it("restores row focus after Back when the filter is not being typed", () => {
    expect(
      shouldRestoreLibraryRowFocus({ reason: "mount", activeElement: null }),
    ).toBe(true);
    expect(
      shouldRestoreLibraryRowFocus({
        reason: "last-selector",
        activeElement: { tagName: "BUTTON", isContentEditable: false },
      }),
    ).toBe(true);
    expect(
      shouldRestoreLibraryRowFocus({ reason: "rows", activeElement: null }),
    ).toBe(false);
  });

  it("gates LibraryResourceList row restore through shouldRestoreLibraryRowFocus", () => {
    const listSource = readFileSync(
      join(
        import.meta.dir,
        "../../apps/desktop/src/components/library/LibraryResourceList.tsx",
      ),
      "utf8",
    );
    expect(listSource).toContain("shouldRestoreLibraryRowFocus");
  });
});
