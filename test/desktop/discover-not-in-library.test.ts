import { describe, expect, test } from "bun:test";
import {
  DEFAULT_NOT_IN_LIBRARY,
  NOT_IN_LIBRARY_STORAGE_KEY,
  readNotInLibraryPreference,
  writeNotInLibraryPreference,
} from "../../apps/desktop/src/lib/discover-not-in-library.ts";

describe("Discover Not in my library preference", () => {
  test("defaults on when storage is empty", () => {
    expect(DEFAULT_NOT_IN_LIBRARY).toBe(true);
    const store = new Map<string, string>();
    expect(
      readNotInLibraryPreference({
        getItem: (key) => store.get(key) ?? null,
      }),
    ).toBe(true);
  });

  test("round-trips the last choice", () => {
    const store = new Map<string, string>();
    writeNotInLibraryPreference(false, {
      setItem: (key, value) => {
        store.set(key, value);
      },
    });
    expect(store.get(NOT_IN_LIBRARY_STORAGE_KEY)).toBe("0");
    expect(
      readNotInLibraryPreference({
        getItem: (key) => store.get(key) ?? null,
      }),
    ).toBe(false);
    writeNotInLibraryPreference(true, {
      setItem: (key, value) => {
        store.set(key, value);
      },
    });
    expect(
      readNotInLibraryPreference({
        getItem: (key) => store.get(key) ?? null,
      }),
    ).toBe(true);
  });
});
