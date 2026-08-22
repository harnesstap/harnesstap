import { describe, expect, test } from "bun:test";
import {
  formatPluginRollbackConfirmMessage,
  pluginHistoryBackLabel,
  pluginPackageActions,
  pluginPackageBackTarget,
  pluginPackageEscapeAction,
  shouldShowPluginHistory,
} from "../../apps/desktop/src/lib/plugin-history.ts";

describe("plugin history navigation", () => {
  test("History is authored head-only", () => {
    expect(shouldShowPluginHistory({ origin: "authored", mode: "head", isDraft: false })).toBe(true);
    expect(shouldShowPluginHistory({ origin: "catalog", mode: "head", isDraft: false })).toBe(false);
    expect(shouldShowPluginHistory({ origin: "authored", mode: "history", isDraft: false })).toBe(false);
    expect(shouldShowPluginHistory({ origin: "authored", mode: "head", isDraft: true })).toBe(false);
  });

  test("back walks frozen → history → head → list", () => {
    expect(pluginPackageBackTarget("frozen")).toBe("history");
    expect(pluginPackageBackTarget("history")).toBe("head");
    expect(pluginPackageBackTarget("head")).toBe("list");
  });

  test("escape dismisses confirm, ignores busy, otherwise matches back", () => {
    expect(
      pluginPackageEscapeAction({
        mode: "frozen",
        fieldEditing: false,
        confirmOpen: true,
        busy: false,
      }),
    ).toBe("dismiss-confirm");
    expect(
      pluginPackageEscapeAction({
        mode: "history",
        fieldEditing: false,
        confirmOpen: false,
        busy: true,
      }),
    ).toBe("noop");
    expect(
      pluginPackageEscapeAction({
        mode: "history",
        fieldEditing: false,
        confirmOpen: false,
        busy: false,
      }),
    ).toBe("head");
  });

  test("back labels match chrome copy", () => {
    expect(pluginHistoryBackLabel("head")).toBe("Back to library list");
    expect(pluginHistoryBackLabel("history")).toBe("Back to plugin");
    expect(pluginHistoryBackLabel("frozen")).toBe("Back to version history");
  });

  test("frozen pane actions are Restore only; head authored includes History", () => {
    expect(
      pluginPackageActions({ origin: "authored", mode: "head", frozen: false }),
    ).toEqual(["apply", "history", "cut", "doctor", "delete"]);
    expect(
      pluginPackageActions({ origin: "catalog", mode: "head", frozen: false }),
    ).toEqual(["apply", "update", "fork", "doctor", "delete"]);
    expect(
      pluginPackageActions({ origin: "upstream", mode: "head", frozen: false }),
    ).toEqual(["apply", "update", "fork", "doctor", "delete"]);
    expect(
      pluginPackageActions({ origin: "authored", mode: "head", frozen: false }),
    ).not.toContain("update");
    expect(
      pluginPackageActions({ origin: "authored", mode: "frozen", frozen: true }),
    ).toEqual(["restore"]);
    expect(
      pluginPackageActions({ origin: "authored", mode: "history", frozen: false }),
    ).toEqual([]);
  });

  test("confirm copy matches CLI", () => {
    expect(
      formatPluginRollbackConfirmMessage({
        headVersion: "1.2.0",
        frozenVersion: "1.0.0",
        dirty: true,
      }),
    ).toContain("unpublished edits on 1.2.0*");
    expect(
      formatPluginRollbackConfirmMessage({
        headVersion: "1.2.0",
        frozenVersion: "1.0.0",
        dirty: false,
      }),
    ).toContain("Replace the working head 1.2.0");
  });
});
