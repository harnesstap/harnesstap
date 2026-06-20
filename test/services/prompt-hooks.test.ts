import { describe, expect, it } from "bun:test";
import {
  appendToQuery,
  backspaceQuery,
  createQueryFilterState,
  handleSearchKeypress,
} from "../../src/services/wizards/prompts/hooks/use-local-query-filter.ts";
import {
  handleNavigationKeypress,
  moveActiveIndex,
} from "../../src/services/wizards/prompts/hooks/use-list-navigation.ts";
import {
  clearVisible,
  selectAllVisible,
  toggleInMap,
} from "../../src/services/wizards/prompts/hooks/use-checkbox-selection.ts";
import {
  createBrowseShowState,
  enterShowView,
  exitShowView,
  handleEnterToShow,
  handleShowViewEscape,
} from "../../src/services/wizards/prompts/hooks/use-browse-show-view.ts";

describe("use-local-query-filter", () => {
  it("appends and backspaces query text", () => {
    expect(appendToQuery("ab", "c")).toBe("abc");
    expect(backspaceQuery("abc")).toBe("ab");
    expect(backspaceQuery("")).toBe("");
  });

  it("creates query filter state helpers", () => {
    const state = createQueryFilterState("go");
    expect(state.query).toBe("go");
    expect(state.appendChar("go", "x")).toEqual({ query: "gox", activeReset: 0 });
    expect(state.backspace("gox")).toEqual({ query: "go", activeReset: 0 });
  });

  it("handles search keypress for type and backspace", () => {
    let query = "ab";
    let active = 2;
    const setQuery = (next: string) => {
      query = next;
    };
    const setActive = (next: number) => {
      active = next;
    };

    expect(
      handleSearchKeypress({
        query,
        setQuery,
        setActive,
        key: { sequence: "c" },
      }),
    ).toBe(true);
    expect(query).toBe("abc");
    expect(active).toBe(0);

    expect(
      handleSearchKeypress({
        query,
        setQuery,
        setActive,
        key: { name: "backspace" },
      }),
    ).toBe(true);
    expect(query).toBe("ab");
    expect(active).toBe(0);

    expect(
      handleSearchKeypress({
        query,
        setQuery,
        setActive,
        key: { name: "up" },
      }),
    ).toBe(false);
  });
});

describe("use-list-navigation", () => {
  it("clamps active index at bounds by default", () => {
    expect(moveActiveIndex(0, -1, 5)).toBe(0);
    expect(moveActiveIndex(4, 1, 5)).toBe(4);
    expect(moveActiveIndex(2, 1, 5)).toBe(3);
    expect(moveActiveIndex(0, 0, 0)).toBe(0);
  });

  it("loops when enabled", () => {
    expect(moveActiveIndex(0, -1, 5, true)).toBe(4);
    expect(moveActiveIndex(4, 1, 5, true)).toBe(0);
  });

  it("handles navigation keypress", () => {
    let active = 1;
    const setActive = (next: number) => {
      active = next;
    };

    expect(
      handleNavigationKeypress({
        clampedActive: 1,
        length: 3,
        setActive,
        key: { name: "down" },
      }),
    ).toBe(true);
    expect(active).toBe(2);

    expect(
      handleNavigationKeypress({
        clampedActive: 2,
        length: 3,
        setActive,
        key: { name: "up" },
      }),
    ).toBe(true);
    expect(active).toBe(1);

    expect(
      handleNavigationKeypress({
        clampedActive: 1,
        length: 0,
        setActive,
        key: { name: "down" },
      }),
    ).toBe(false);
  });
});

describe("use-checkbox-selection", () => {
  const keyFn = (item: { id: string }) => item.id;

  it("toggles items in a map", () => {
    const item = { id: "a", label: "A" };
    const checked = toggleInMap(new Map(), "a", item);
    expect(checked.get("a")).toEqual(item);

    const unchecked = toggleInMap(checked, "a", item);
    expect(unchecked.has("a")).toBe(false);
  });

  it("selects all visible items without clearing hidden selections", () => {
    const hidden = { id: "hidden", label: "Hidden" };
    const visible = [
      { id: "one", label: "One" },
      { id: "two", label: "Two" },
    ];
    const initial = new Map([["hidden", hidden]]);

    const next = selectAllVisible(initial, visible, keyFn);
    expect(next.size).toBe(3);
    expect(next.get("hidden")).toEqual(hidden);
    expect(next.get("one")).toEqual(visible[0]);
    expect(next.get("two")).toEqual(visible[1]);
  });

  it("clears only visible items", () => {
    const hidden = { id: "hidden", label: "Hidden" };
    const visible = [{ id: "one", label: "One" }];
    const initial = new Map<string, { id: string; label: string }>([
      ["hidden", hidden],
      ["one", visible[0]!],
    ]);

    const next = clearVisible(initial, visible, keyFn);
    expect(next.size).toBe(1);
    expect(next.get("hidden")).toEqual(hidden);
    expect(next.has("one")).toBe(false);
  });
});

describe("use-browse-show-view", () => {
  it("creates and transitions browse/show state", () => {
    expect(createBrowseShowState<{ id: string }>()).toEqual({
      view: "browse",
      showingItem: null,
    });
    expect(enterShowView({ id: "a" })).toEqual({
      view: "show",
      showingItem: { id: "a" },
    });
    expect(exitShowView()).toEqual({
      view: "browse",
      showingItem: null,
    });
  });

  it("handles enter-to-show and esc-to-browse", () => {
    let view: "browse" | "show" = "browse";
    let showingItem: { id: string } | null = null;
    const setView = (next: "browse" | "show") => {
      view = next;
    };
    const setShowingItem = (next: { id: string } | null) => {
      showingItem = next;
    };

    expect(
      handleEnterToShow({
        item: { id: "a" },
        setView,
        setShowingItem,
      }),
    ).toBe(true);
    expect(view).toBe("show");
    expect(showingItem).toEqual({ id: "a" });

    expect(
      handleShowViewEscape({
        view,
        setView,
        setShowingItem,
        key: { name: "escape" },
      }),
    ).toBe(true);
    expect(view).toBe("browse");
    expect(showingItem).toBeNull();
  });
});
