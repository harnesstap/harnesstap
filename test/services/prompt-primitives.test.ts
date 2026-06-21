import { describe, expect, it } from "bun:test";
import {
  buildHelpLine,
  clampActiveIndex,
  isEscapeKey,
  isSearchCharacter,
} from "../../src/services/wizards/prompts/primitives.ts";

describe("prompt primitives", () => {
  it("detects escape key", () => {
    expect(isEscapeKey({ name: "escape" })).toBe(true);
    expect(isEscapeKey({ sequence: "\u001b" })).toBe(true);
    expect(isEscapeKey({ name: "a" })).toBe(false);
  });

  it("accepts printable characters including shift-modified input", () => {
    expect(isSearchCharacter({ sequence: "a" })).toBe(true);
    expect(isSearchCharacter({ sequence: "A", shift: true })).toBe(true);
    expect(isSearchCharacter({ sequence: " ", shift: true })).toBe(false);
    expect(isSearchCharacter({ sequence: "a", ctrl: true })).toBe(false);
  });

  it("clamps active index", () => {
    expect(clampActiveIndex(0, 0)).toBe(0);
    expect(clampActiveIndex(5, 3)).toBe(2);
    expect(clampActiveIndex(-1, 3)).toBe(0);
  });

  it("builds help lines", () => {
    expect(buildHelpLine([["esc", "exit"], ["⏎", "submit"]]))
      .toBe("esc exit • ⏎ submit");
  });
});
