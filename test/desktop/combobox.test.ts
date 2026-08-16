import { describe, expect, test } from "bun:test";
import {
  commitCustomOnClose,
  customComboboxOption,
  filterComboboxOptions,
} from "../../apps/desktop/src/lib/combobox.ts";

const options = [
  { value: "profile", label: "profile" },
  { value: "team", label: "team" },
];

describe("filterComboboxOptions", () => {
  test("returns every option when the query is empty or whitespace", () => {
    expect(filterComboboxOptions(options, "")).toEqual(options);
    expect(filterComboboxOptions(options, "   ")).toEqual(options);
  });

  test("matches labels case-insensitively by substring", () => {
    expect(filterComboboxOptions(options, "TEA")).toEqual([
      { value: "team", label: "team" },
    ]);
  });
});

describe("customComboboxOption", () => {
  test("Enter can commit a typed value that is not already an option", () => {
    expect(customComboboxOption(options, "  ops  ")).toEqual({
      value: "ops",
      label: "ops",
    });
  });

  test("does not synthesize an option for empty or existing values", () => {
    expect(customComboboxOption(options, "")).toBeNull();
    expect(customComboboxOption(options, "   ")).toBeNull();
    expect(customComboboxOption(options, "profile")).toBeNull();
    expect(customComboboxOption(options, "TEAM")).toBeNull();
  });
});

describe("commitCustomOnClose", () => {
  test("blur or close commits the trimmed query", () => {
    expect(
      commitCustomOnClose({
        allowCustom: true,
        query: "  ops  ",
        cancelled: false,
        currentValue: "",
      }),
    ).toBe("ops");
  });

  test("Escape cancels and does not commit", () => {
    expect(
      commitCustomOnClose({
        allowCustom: true,
        query: "ops",
        cancelled: true,
        currentValue: "",
      }),
    ).toBeNull();
  });

  test("ignores empty, duplicate, and non-custom closes", () => {
    expect(
      commitCustomOnClose({
        allowCustom: true,
        query: "   ",
        cancelled: false,
        currentValue: "",
      }),
    ).toBeNull();
    expect(
      commitCustomOnClose({
        allowCustom: true,
        query: "ops",
        cancelled: false,
        currentValue: "ops",
      }),
    ).toBeNull();
    expect(
      commitCustomOnClose({
        allowCustom: false,
        query: "ops",
        cancelled: false,
        currentValue: "",
      }),
    ).toBeNull();
  });
});
