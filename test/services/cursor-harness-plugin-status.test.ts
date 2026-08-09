import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import {
  buildCursorHarnessPluginRows,
  buildHarnessLiveStatusMap,
} from "../../src/services/global-profile-status-panel.js";

const fixtureHome = join(
  import.meta.dirname,
  "../fixtures/cursor-plugins-home",
);

describe("buildCursorHarnessPluginRows", () => {
  it("marks enabled pins installed and ignores disabled cache as extras", () => {
    const rows = buildCursorHarnessPluginRows(
      [
        { ref: "active-plugin@cursor-public", version_constraint: "*" },
        { ref: "dormant@cursor-public", version_constraint: "*" },
      ],
      fixtureHome,
    );

    expect(rows).toEqual([
      { id: "active-plugin@cursor-public", state: "installed" },
      { id: "dormant@cursor-public", state: "missing" },
      { id: "homemade@local", state: "extra" },
    ]);
  });

  it("matches pins by plugin name across marketplace aliases", () => {
    const rows = buildCursorHarnessPluginRows(
      [{ ref: "active-plugin@some-other-market", version_constraint: "*" }],
      fixtureHome,
    );
    expect(rows[0]).toEqual({
      id: "active-plugin@some-other-market",
      state: "installed",
    });
  });
});

describe("buildHarnessLiveStatusMap cursor plugins", () => {
  it("populates cursor plugin rows at full depth", () => {
    const map = buildHarnessLiveStatusMap({
      depth: "full",
      homeRoot: fixtureHome,
      declaredPins: [
        { ref: "active-plugin@cursor-public", version_constraint: "*" },
      ],
      declaredMcpByHarness: { cursor: [], "claude-code": [] },
    });

    expect(map.cursor?.plugins).toEqual([
      { id: "active-plugin@cursor-public", state: "installed" },
      { id: "homemade@local", state: "extra" },
    ]);
    // Declared pins are shared; Claude still evaluates every pin against its installs.
    expect(map["claude-code"]?.plugins).toEqual([
      { id: "active-plugin@cursor-public", state: "missing" },
    ]);
  });

  it("does not mark Claude-only pins missing on Cursor", () => {
    const rows = buildCursorHarnessPluginRows(
      [{ ref: "demo@demo-market", version_constraint: "*" }],
      fixtureHome,
    );
    // demo exists in Cursor cache under demo@cursor-public, so name matches.
    expect(rows.some((row) => row.id === "demo@demo-market")).toBe(true);
    expect(rows.find((row) => row.id === "demo@demo-market")?.state).toBe(
      "missing",
    );

    const claudeOnly = buildCursorHarnessPluginRows(
      [{ ref: "totally-claude-only@teads-plugins", version_constraint: "*" }],
      fixtureHome,
    );
    expect(claudeOnly.every((row) => row.state !== "missing" || row.id !== "totally-claude-only@teads-plugins")).toBe(
      true,
    );
    expect(
      claudeOnly.some((row) => row.id === "totally-claude-only@teads-plugins"),
    ).toBe(false);
  });
});
