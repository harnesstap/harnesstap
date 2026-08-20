import { describe, expect, test } from "bun:test";
import {
  popSourcesPane,
  sourcesEscapeAction,
  sourcesPaneHasPrevious,
  sourcesSidebarChangeAction,
  type SourcesPane,
} from "../../apps/desktop/src/lib/sources-pane.ts";

describe("sources pane stack", () => {
  test("list has no previous pane; plugin-tree and preview do", () => {
    expect(sourcesPaneHasPrevious({ mode: "list" })).toBe(false);
    expect(sourcesPaneHasPrevious({ mode: "plugin-tree", hitId: "p1" })).toBe(
      true,
    );
    expect(sourcesPaneHasPrevious({ mode: "preview", hitId: "p1" })).toBe(true);
    expect(
      sourcesPaneHasPrevious({
        mode: "preview",
        hitId: "p1",
        filePath: "skills/foo.md",
      }),
    ).toBe(true);
  });

  test("standalone preview without filePath pops to list", () => {
    const pane: SourcesPane = { mode: "preview", hitId: "skill-1" };
    expect(popSourcesPane(pane)).toEqual({ mode: "list" });
  });

  test("contained file preview pops to plugin-tree for the same hit", () => {
    const pane: SourcesPane = {
      mode: "preview",
      hitId: "plugin-1",
      filePath: "skills/foo.md",
    };
    expect(popSourcesPane(pane)).toEqual({
      mode: "plugin-tree",
      hitId: "plugin-1",
    });
  });

  test("plugin-tree pops to list", () => {
    expect(popSourcesPane({ mode: "plugin-tree", hitId: "plugin-1" })).toEqual({
      mode: "list",
    });
  });

  test("popping list is a no-op", () => {
    const list: SourcesPane = { mode: "list" };
    expect(popSourcesPane(list)).toEqual({ mode: "list" });
  });
});

describe("sources escape and sidebar change", () => {
  test("confirmOpen dismisses confirm instead of leaving the pane", () => {
    expect(sourcesEscapeAction({ confirmOpen: true })).toBe("dismiss-confirm");
    expect(sourcesEscapeAction({ confirmOpen: false })).toBe("leave-pane");
  });

  test("busy or open confirm blocks sidebar changes", () => {
    expect(
      sourcesSidebarChangeAction({ busy: true, confirmOpen: false }),
    ).toBe("block");
    expect(
      sourcesSidebarChangeAction({ busy: false, confirmOpen: true }),
    ).toBe("block");
    expect(
      sourcesSidebarChangeAction({ busy: true, confirmOpen: true }),
    ).toBe("block");
    expect(
      sourcesSidebarChangeAction({ busy: false, confirmOpen: false }),
    ).toBe("leave-and-apply");
  });
});
