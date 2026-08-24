import { describe, expect, test } from "bun:test";
import {
  applyProfileRailOrder,
  insertBeforeIndexForDrop,
  loadProfileRailOrder,
  PROFILE_RAIL_ORDER_STORAGE_KEY,
  reorderProfileNames,
  saveProfileRailOrder,
} from "../../apps/desktop/src/lib/profile-rail-order.ts";

function memoryStorage(initial: Record<string, string> = {}): {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
} {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe("applyProfileRailOrder", () => {
  test("follows saved order then appends new names A-Z", () => {
    expect(
      applyProfileRailOrder(["alpha", "zeta", "beta"], ["zeta", "alpha"]),
    ).toEqual(["zeta", "alpha", "beta"]);
  });

  test("drops unknown saved names", () => {
    expect(applyProfileRailOrder(["beta", "alpha"], ["gone", "beta"])).toEqual([
      "beta",
      "alpha",
    ]);
  });

  test("sorts A-Z when saved is empty", () => {
    expect(applyProfileRailOrder(["zeta", "alpha"], [])).toEqual([
      "alpha",
      "zeta",
    ]);
  });
});

describe("reorderProfileNames", () => {
  test("moves a name before a later target", () => {
    expect(reorderProfileNames(["a", "b", "c"], 0, 2)).toEqual(["b", "a", "c"]);
  });

  test("moves a name to the end", () => {
    expect(reorderProfileNames(["a", "b", "c"], 0, 3)).toEqual(["b", "c", "a"]);
  });

  test("moves a later name before an earlier one", () => {
    expect(reorderProfileNames(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  test("returns the same order when insert index is a no-op", () => {
    expect(reorderProfileNames(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
    expect(reorderProfileNames(["a", "b", "c"], 1, 2)).toEqual(["a", "b", "c"]);
  });
});

describe("insertBeforeIndexForDrop", () => {
  test("inserts before the target on the upper half", () => {
    expect(insertBeforeIndexForDrop(2, false)).toBe(2);
  });

  test("inserts after the target on the lower half", () => {
    expect(insertBeforeIndexForDrop(2, true)).toBe(3);
  });
});

describe("profile rail order persistence", () => {
  test("loads empty orders when storage is missing or corrupt", () => {
    expect(loadProfileRailOrder(memoryStorage())).toEqual({
      home: [],
      project: [],
    });
    expect(
      loadProfileRailOrder(
        memoryStorage({ [PROFILE_RAIL_ORDER_STORAGE_KEY]: "{" }),
      ),
    ).toEqual({ home: [], project: [] });
  });

  test("saves one view without clobbering the other", () => {
    const storage = memoryStorage({
      [PROFILE_RAIL_ORDER_STORAGE_KEY]: JSON.stringify({
        home: ["work"],
        project: ["default"],
      }),
    });
    const next = saveProfileRailOrder("home", ["zeta", "work"], storage);
    expect(next).toEqual({ home: ["zeta", "work"], project: ["default"] });
    const stored = storage.getItem(PROFILE_RAIL_ORDER_STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toEqual(next);
  });
});
