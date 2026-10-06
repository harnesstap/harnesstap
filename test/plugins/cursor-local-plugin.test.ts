import { describe, expect, it } from "bun:test";
import { cursorLocalPluginLoadState } from "../../src/plugins/cursor-local-plugin.ts";

describe("cursorLocalPluginLoadState", () => {
  it("reports a loaded folder, a newer copy, a rejection, and a marketplace shadow", () => {
    const log = [
      "loadUserLocalPlugin demo loaded in 4.0ms",
      "loadUserLocalPlugin other rejected: symlink target is outside",
    ].join("\n");

    expect(cursorLocalPluginLoadState({
      folderName: "demo",
      folderMtimeMs: 10,
      shadowed: false,
      logText: log,
      logMtimeMs: 20,
    })).toBe("loaded");

    expect(cursorLocalPluginLoadState({
      folderName: "demo",
      folderMtimeMs: 30,
      shadowed: false,
      logText: log,
      logMtimeMs: 20,
    })).toBe("pending_reload");

    expect(cursorLocalPluginLoadState({
      folderName: "other",
      folderMtimeMs: 10,
      shadowed: false,
      logText: log,
      logMtimeMs: 20,
    })).toBe("rejected");

    expect(cursorLocalPluginLoadState({
      folderName: "demo",
      folderMtimeMs: 10,
      shadowed: true,
      logText: log,
      logMtimeMs: 20,
    })).toBe("shadowed");
  });
});
