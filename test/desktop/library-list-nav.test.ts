import { describe, expect, it } from "bun:test";
import {
  isLibraryListNavKey,
  isLibraryTypeaheadChar,
  LIBRARY_TYPEAHEAD_MS,
  matchLibraryTypeahead,
  nextLibraryListIndex,
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
});
