import { describe, expect, test } from "bun:test";
import {
  canPopScreenHistory,
  popScreenHistory,
  pushScreenHistory,
  WORKSPACE_BACK_LABEL,
  workspaceBackEnabled,
} from "../../apps/desktop/src/lib/screen-history.ts";

describe("screen history", () => {
  test("pushing a different destination records the current screen", () => {
    expect(pushScreenHistory([], "scope", "library")).toEqual(["scope"]);
    expect(pushScreenHistory(["scope"], "library", "environments")).toEqual([
      "scope",
      "library",
    ]);
  });

  test("pushing the current destination does not grow the stack", () => {
    expect(pushScreenHistory(["scope"], "library", "library")).toEqual(["scope"]);
    expect(pushScreenHistory([], "scope", "scope")).toEqual([]);
  });

  test("pop returns the previous screen and shortens the stack", () => {
    expect(popScreenHistory(["scope", "library"])).toEqual({
      stack: ["scope"],
      previous: "library",
    });
    expect(popScreenHistory(["scope"])).toEqual({
      stack: [],
      previous: "scope",
    });
  });

  test("pop of an empty stack has no previous screen", () => {
    expect(popScreenHistory([])).toEqual({ stack: [], previous: null });
    expect(canPopScreenHistory([])).toBe(false);
    expect(canPopScreenHistory(["scope"])).toBe(true);
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
