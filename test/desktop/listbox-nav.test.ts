import { describe, expect, it } from "bun:test";
import {
  isListboxNavKey,
  isListboxTypeaheadChar,
  LISTBOX_TYPEAHEAD_MS,
  matchListboxTypeahead,
  nextListboxIndex,
} from "../../apps/desktop/src/lib/listbox-nav.ts";

describe("shared listbox keyboard nav", () => {
  it("moves without wrapping and jumps Home/End", () => {
    expect(nextListboxIndex(0, "ArrowDown", 4)).toBe(1);
    expect(nextListboxIndex(3, "ArrowDown", 4)).toBe(3);
    expect(nextListboxIndex(0, "ArrowUp", 4)).toBe(0);
    expect(nextListboxIndex(2, "Home", 4)).toBe(0);
    expect(nextListboxIndex(1, "End", 4)).toBe(3);
    expect(isListboxNavKey("ArrowDown")).toBe(true);
    expect(isListboxNavKey("Enter")).toBe(false);
  });

  it("typeahead matches prefixes from the current index and wraps", () => {
    const labels = ["alpha", "beta", "ship", "skill"];
    expect(matchListboxTypeahead(labels, "s", 0)).toBe(2);
    expect(matchListboxTypeahead(labels, "sk", 2)).toBe(3);
    expect(matchListboxTypeahead(labels, "a", 1)).toBe(0);
    expect(matchListboxTypeahead(labels, "z", 0)).toBe(-1);
    expect(isListboxTypeaheadChar("s")).toBe(true);
    expect(isListboxTypeaheadChar("Enter")).toBe(false);
    expect(LISTBOX_TYPEAHEAD_MS).toBe(500);
  });
});
