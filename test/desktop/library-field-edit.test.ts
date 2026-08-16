import { describe, expect, test } from "bun:test";
import { fieldKeyAction } from "../../apps/desktop/src/lib/library-field-edit.ts";

describe("fieldKeyAction", () => {
  test("Enter commits and Esc cancels while editing", () => {
    expect(fieldKeyAction("Enter")).toBe("commit");
    expect(fieldKeyAction("Escape")).toBe("cancel");
    expect(fieldKeyAction("Tab")).toBe(null);
  });

  test("Enter does not commit in a textarea", () => {
    expect(fieldKeyAction("Enter", { multiline: true })).toBe(null);
    expect(fieldKeyAction("Escape", { multiline: true })).toBe("cancel");
  });
});
