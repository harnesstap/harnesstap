import { describe, expect, it } from "bun:test";
import {
  harnessPillState,
  mergeStatusUpdate,
} from "../../apps/desktop/src/lib/status-merge.ts";
import type { GlobalProfileStatus } from "../../apps/desktop/src/lib/types.ts";

function baseStatus(
  overrides: Partial<GlobalProfileStatus> = {},
): GlobalProfileStatus {
  return {
    active_profile: "work",
    profile_exists: true,
    applied: true,
    snapshot_id: "snap-1",
    snapshot_at: "2026-01-01T00:00:00.000Z",
    stack_in_sync: true,
    has_drift: false,
    depth: "full",
    as_of: "2026-01-01T00:00:00.000Z",
    panel: { status: "green", reasons: [] },
    harnesses: {
      "claude-code": {
        plugins: [{ id: "demo@demo", state: "installed" }],
        mcp: [],
      },
      cursor: { plugins: [], mcp: [{ name: "search", state: "present" }] },
    },
    contents: {
      layers: [
        {
          id: "l1",
          name: "work",
          version: "1.0.0",
          resources: [
            { type: "instruction", name: "guide" },
            { type: "mcp_server", name: "search" },
          ],
        },
      ],
      stack_resource_count: 1,
      stack_summary: "1 instruction",
      type_counts: { layer: 1, instruction: 1, mcp_server: 1 },
      resources: [
        { type: "instruction", name: "guide" },
        { type: "mcp_server", name: "search" },
      ],
      plugin_pins: [],
      mcp_servers: ["search"],
    },
    drift_summary: {
      global: { status: "clean", owned_changes: 0, non_owned_changes: 0 },
    },
    ...overrides,
  };
}

describe("desktop status merge", () => {
  it("keeps full harnesses and contents when merging a fast poll", () => {
    const previous = baseStatus();
    const next = baseStatus({
      depth: "fast",
      as_of: "2026-01-01T00:00:02.000Z",
      panel: { status: "yellow", reasons: ["fast_depth"] },
      harnesses: {
        "claude-code": { plugins: [], mcp: [] },
        cursor: { plugins: [], mcp: [] },
      },
      contents: null,
    });

    const merged = mergeStatusUpdate(previous, next, "fast");

    expect(merged.depth).toBe("fast");
    expect(merged.panel.reasons).toContain("fast_depth");
    expect(merged.harnesses["claude-code"]?.plugins).toEqual([
      { id: "demo@demo", state: "installed" },
    ]);
    expect(merged.harnesses.cursor?.mcp).toEqual([
      { name: "search", state: "present" },
    ]);
    expect(merged.contents?.stack_summary).toBe("1 instruction");
  });

  it("replaces state on full depth", () => {
    const previous = baseStatus();
    const next = baseStatus({
      active_profile: "other",
      harnesses: {
        "claude-code": { plugins: [], mcp: [] },
        cursor: { plugins: [], mcp: [] },
      },
      contents: {
        layers: [],
        stack_resource_count: 0,
        stack_summary: null,
        plugin_pins: [],
        mcp_servers: [],
      },
    });

    const merged = mergeStatusUpdate(previous, next, "full");
    expect(merged.active_profile).toBe("other");
    expect(merged.harnesses["claude-code"]?.plugins).toEqual([]);
    expect(merged.contents?.stack_resource_count).toBe(0);
  });

  it("gates harness pills until a full snapshot exists", () => {
    expect(harnessPillState(false, 0, 0)).toBe("checking");
    expect(harnessPillState(true, 0, 0)).toBe("ok");
    expect(harnessPillState(true, 1, 0)).toBe("issues");
  });
});
