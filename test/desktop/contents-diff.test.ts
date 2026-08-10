import { describe, expect, it } from "bun:test";
import {
  aggregateInstallGaps,
  diffProfileContents,
  fileChangeAction,
  orderedTypeCounts,
  summarizeStackChanges,
} from "../../apps/desktop/src/lib/contents-diff.ts";
import type { ProfileContents } from "../../apps/desktop/src/lib/types.ts";

function contents(
  overrides: Partial<ProfileContents> = {},
): ProfileContents {
  return {
    plugins: [
      {
        id: "l1",
        name: "work",
        version: "1.0.0",
        resources: [
          { type: "skill", name: "ship" },
          { type: "mcp_server", name: "docs" },
        ],
      },
    ],
    stack_resource_count: 2,
    stack_summary: "1 skill, 1 mcp_server",
    type_counts: { plugin: 1, skill: 1, mcp_server: 1 },
    resources: [
      { type: "skill", name: "ship" },
      { type: "mcp_server", name: "docs" },
    ],
    plugin_pins: [],
    mcp_servers: ["docs"],
    ...overrides,
  };
}

describe("contents-diff helpers", () => {
  it("diffs added, removed, and unchanged stack items", () => {
    const target = contents({
      resources: [
        { type: "skill", name: "ship" },
        { type: "skill", name: "review" },
        { type: "mcp_server", name: "docs" },
      ],
      type_counts: { plugin: 1, skill: 2, mcp_server: 1 },
      stack_resource_count: 3,
    });
    const live = contents({
      resources: [
        { type: "skill", name: "ship" },
        { type: "mcp_server", name: "legacy" },
      ],
      mcp_servers: ["legacy"],
      type_counts: { plugin: 1, skill: 1, mcp_server: 1 },
    });

    const diff = diffProfileContents(target, live);
    expect(diff.added.map((row) => row.label).sort()).toEqual(["docs", "review"]);
    expect(diff.removed.map((row) => row.label).sort()).toEqual(["legacy"]);
    expect(diff.unchanged.map((row) => row.label).sort()).toEqual([
      "ship",
      "work",
    ]);
  });

  it("orders type counts for summary strips", () => {
    expect(
      orderedTypeCounts({
        mcp_server: 10,
        skill: 5,
        plugin: 2,
        plugin_pin: 1,
      }).map((row) => `${row.count} ${row.label}`),
    ).toEqual(["2 plugins", "5 skills", "10 MCP", "1 plugin"]);
  });

  it("summarizes stack changes with add/remove/mixed tones", () => {
    const target = contents({
      plugins: [
        {
          id: "l1",
          name: "work",
          version: "1.0.0",
          resources: [],
        },
        {
          id: "l2",
          name: "extra",
          version: "1.0.0",
          resources: [],
        },
      ],
      resources: [
        { type: "skill", name: "ship" },
        { type: "skill", name: "review" },
        { type: "mcp_server", name: "docs" },
        { type: "command", name: "deploy" },
      ],
      type_counts: { plugin: 2, skill: 2, mcp_server: 1, command: 1 },
    });
    const live = contents({
      plugins: [
        {
          id: "l1",
          name: "work",
          version: "1.0.0",
          resources: [],
        },
      ],
      resources: [
        { type: "skill", name: "ship" },
        { type: "skill", name: "legacy" },
        { type: "mcp_server", name: "old" },
        { type: "instruction", name: "readme" },
      ],
      type_counts: { plugin: 1, skill: 2, mcp_server: 1, instruction: 1 },
    });

    const diff = diffProfileContents(target, live);
    expect(
      summarizeStackChanges(diff.added, diff.removed).map((row) => ({
        type: row.type,
        count: row.count,
        label: row.label,
        tone: row.tone,
      })),
    ).toEqual([
      { type: "plugin", count: 1, label: "plugin", tone: "add" },
      { type: "skill", count: 2, label: "skills", tone: "mixed" },
      { type: "mcp_server", count: 2, label: "MCP", tone: "mixed" },
      { type: "instruction", count: 1, label: "instruction", tone: "remove" },
      { type: "command", count: 1, label: "command", tone: "add" },
    ]);
  });

  it("maps file change types to apply verbs", () => {
    expect(fileChangeAction({ path: "a", type: "deleted" })).toEqual({
      action: "add",
      label: "add",
    });
    expect(fileChangeAction({ path: "a", type: "modified" })).toEqual({
      action: "update",
      label: "update",
    });
    expect(fileChangeAction({ path: "a", type: "added" })).toEqual({
      action: "remove",
      label: "remove",
    });
  });

  it("aggregates install gaps with clear labels", () => {
    const gaps = aggregateInstallGaps({
      "claude-code": {
        plugins: [
          { id: "demo@demo", state: "missing" },
          { id: "extra@x", state: "extra" },
        ],
        mcp: [{ name: "docs", state: "present" }],
      },
      cursor: {
        plugins: [{ id: "demo@demo", state: "missing" }],
        mcp: [{ name: "search", state: "extra" }],
      },
    });

    expect(gaps).toEqual([
      {
        key: "plugin:missing:demo@demo",
        label: "plugin demo@demo",
        kind: "missing",
        harnesses: ["claude-code", "cursor"],
      },
      {
        key: "mcp:outside_profile:search",
        label: "mcp search",
        kind: "outside_profile",
        harnesses: ["cursor"],
      },
      {
        key: "plugin:outside_profile:extra@x",
        label: "plugin extra@x",
        kind: "outside_profile",
        harnesses: ["claude-code"],
      },
    ]);
  });
});
