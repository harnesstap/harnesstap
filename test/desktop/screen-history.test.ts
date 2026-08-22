import { describe, expect, test } from "bun:test";
import {
  canPopScreenHistory,
  popScreenHistory,
  pushScreenHistory,
  workspaceBackEnabled,
  WORKSPACE_BACK_LABEL,
} from "../../apps/desktop/src/lib/screen-history.ts";

describe("screen history", () => {
  test("pushing a different destination records the current screen", () => {
    expect(pushScreenHistory([], "home", "library")).toEqual(["home"]);
    expect(pushScreenHistory(["home"], "library", "environments")).toEqual([
      "home",
      "library",
    ]);
  });

  test("pushing the current destination does not grow the stack", () => {
    expect(pushScreenHistory(["home"], "library", "library")).toEqual(["home"]);
    expect(pushScreenHistory([], "home", "home")).toEqual([]);
  });

  test("pop returns the previous screen and shortens the stack", () => {
    expect(popScreenHistory(["home", "library"])).toEqual({
      stack: ["home"],
      previous: "library",
    });
    expect(popScreenHistory(["home"])).toEqual({
      stack: [],
      previous: "home",
    });
  });

  test("pop of an empty stack has no previous screen", () => {
    expect(popScreenHistory([])).toEqual({ stack: [], previous: null });
    expect(canPopScreenHistory([])).toBe(false);
    expect(canPopScreenHistory(["home"])).toBe(true);
  });
});

describe("workspace back enablement", () => {
  test("is enabled when a nested pane or a previous workspace exists", () => {
    expect(
      workspaceBackEnabled({
        hasLocalPrevious: false,
        hasWorkspacePrevious: false,
      }),
    ).toBe(false);
    expect(
      workspaceBackEnabled({
        hasLocalPrevious: true,
        hasWorkspacePrevious: false,
      }),
    ).toBe(true);
    expect(
      workspaceBackEnabled({
        hasLocalPrevious: false,
        hasWorkspacePrevious: true,
      }),
    ).toBe(true);
  });

  test("uses a stable Back label for the header control", () => {
    expect(WORKSPACE_BACK_LABEL).toBe("Back");
  });
});
