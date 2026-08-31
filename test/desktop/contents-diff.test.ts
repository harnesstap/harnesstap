import { describe, expect, it } from "bun:test";
import {
  aggregateInstallGaps,
  countFileChangeKindResources,
  diffProfileContents,
  fileChangeAction,
  fileChangeDestinationSummary,
  fileChangeMatchesKindFilter,
  filterFileChangeGroups,
  groupFileChangesByResource,
  liveMcpNamesFromHarnesses,
  orderedTypeCounts,
  summarizeStackChanges,
  uniqueFileChanges,
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
    expect(diff.unchanged.map((row) => row.label).sort()).toEqual(["work"]);
  });

  it("does not list nested plugin skills as stack adds or inherited live removals", () => {
    const target = contents({
      plugins: [
        {
          id: "teads",
          name: "Teads (Default)",
          version: "1.0.1",
          resources: [
            { type: "skill", name: "direct-skill" },
            { type: "mcp_server", name: "docs" },
          ],
        },
      ],
      plugin_pins: [
        { ref: "superpowers@claude-plugins-official", version_constraint: "latest" },
      ],
      resources: [
        { type: "skill", name: "direct-skill" },
        { type: "skill", name: "brainstorming", origin_kind: "marketplace_link", origin_ref: "superpowers@claude-plugins-official" },
        { type: "mcp_server", name: "docs" },
      ],
    });
    const live = contents({
      plugins: [
        {
          id: "global",
          name: "global default",
          version: "1.0.0",
          resources: [],
        },
      ],
      plugin_pins: [],
      resources: [
        { type: "skill", name: "brainstorming", origin_kind: "marketplace_link", origin_ref: "superpowers@claude-plugins-official" },
        { type: "skill", name: "legacy-local" },
        { type: "mcp_server", name: "legacy" },
      ],
      mcp_servers: ["legacy"],
    });

    const diff = diffProfileContents(target, live, {
      ownedResourceKeys: new Set(["skill:brainstorming", "skill:direct-skill"]),
      installedPinRefs: new Set(["superpowers@claude-plugins-official", "superpowers"]),
      ignorePluginNames: new Set(["Teads (Default)", "global default"]),
    });

    expect(diff.added.map((row) => `${row.iconType}:${row.label}`).sort()).toEqual([
      "mcp_server:docs",
    ]);
    expect(diff.removed.map((row) => `${row.iconType}:${row.label}`).sort()).toEqual([
      "mcp_server:legacy",
      "skill:legacy-local",
    ]);
  });

  it("omits snapshot-only MCP stack removals that are gone from live harness config", () => {
    const target = contents({
      resources: [{ type: "mcp_server", name: "kept" }],
      mcp_servers: ["kept"],
    });
    const live = contents({
      resources: [
        { type: "mcp_server", name: "kept" },
        { type: "mcp_server", name: "stale-snapshot", source: "~/.cursor/mcp.json" },
        { type: "mcp_server", name: "live-extra", source: "~/.cursor/mcp.json" },
      ],
      mcp_servers: ["kept", "stale-snapshot", "live-extra"],
    });

    const diff = diffProfileContents(target, live, {
      liveMcpNames: new Set(["kept", "live-extra"]),
    });

    expect(diff.removed.map((row) => row.label).sort()).toEqual(["live-extra"]);
  });

  it("collects live MCP names from harness extra and present rows", () => {
    expect(
      [
        ...liveMcpNamesFromHarnesses({
          cursor: {
            plugins: [],
            mcp: [
              { name: "kept", state: "present" },
              { name: "gone", state: "missing" },
              { name: "extra", state: "extra" },
            ],
          },
        }) ?? [],
      ].sort(),
    ).toEqual(["extra", "kept"]);
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

  it("counts unique related resources per file-change kind", () => {
    const changes = uniqueFileChanges([
      {
        path: ".claude/skills/x/SKILL.md",
        type: "deleted",
        resource: { type: "skill", name: "x" },
      },
      {
        path: ".claude/skills/x/notes.md",
        type: "deleted",
        resource: { type: "skill", name: "x" },
      },
      {
        path: ".claude/skills/y/SKILL.md",
        type: "added",
        resource: { type: "skill", name: "y" },
      },
      { path: ".cursor/mcp.json", type: "modified" },
      { path: ".cursor/mcp.json", type: "modified" },
    ]);

    expect(countFileChangeKindResources(changes)).toEqual({
      add: 1,
      remove: 1,
      update: 1,
    });
  });

  it("filters file changes by selected kinds; empty selection shows all", () => {
    const added = { path: "missing.md", type: "deleted" as const };
    const removed = { path: "extra.md", type: "added" as const };
    const modified = { path: "edit.md", type: "modified" as const };

    expect(fileChangeMatchesKindFilter(added, new Set())).toBe(true);
    expect(fileChangeMatchesKindFilter(added, new Set(["add"]))).toBe(true);
    expect(fileChangeMatchesKindFilter(removed, new Set(["add"]))).toBe(false);
    expect(fileChangeMatchesKindFilter(modified, new Set(["add", "update"]))).toBe(
      true,
    );
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
        iconType: "plugin",
        harnesses: ["claude-code", "cursor"],
      },
      {
        key: "mcp:outside_profile:search",
        label: "mcp search",
        kind: "outside_profile",
        iconType: "mcp_server",
        harnesses: ["cursor"],
      },
      {
        key: "plugin:outside_profile:extra@x",
        label: "plugin extra@x",
        kind: "outside_profile",
        iconType: "plugin",
        harnesses: ["claude-code"],
      },
    ]);
  });

  it("groups file changes by resource across harness paths", () => {
    const groups = groupFileChangesByResource([
      {
        path: ".claude/skills/ship/SKILL.md",
        type: "deleted",
        platform: "claude-code",
        resource: { type: "skill", name: "ship", origin_kind: "local_snapshot" },
      },
      {
        path: ".cursor/skills/ship/SKILL.md",
        type: "deleted",
        platform: "cursor",
        resource: { type: "skill", name: "ship", origin_kind: "local_snapshot" },
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: "skill:ship",
      singleton: false,
      kinds: ["add"],
      platforms: ["claude-code", "cursor"],
      resource: { type: "skill", name: "ship" },
    });
    expect(groups[0].changes).toHaveLength(2);
  });

  it("marks a one-file resource group as singleton", () => {
    const groups = groupFileChangesByResource([
      {
        path: ".claude/skills/ship/SKILL.md",
        type: "deleted",
        platform: "claude-code",
        resource: { type: "skill", name: "ship" },
      },
    ]);
    expect(groups).toEqual([
      expect.objectContaining({
        key: "skill:ship",
        singleton: true,
        kinds: ["add"],
        platforms: ["claude-code"],
      }),
    ]);
  });

  it("keeps unmapped paths as their own groups", () => {
    const groups = groupFileChangesByResource([
      { path: ".cursor/mcp.json", type: "modified", platform: "cursor" },
    ]);
    expect(groups).toEqual([
      expect.objectContaining({
        key: "path:.cursor/mcp.json",
        resource: null,
        singleton: true,
        kinds: ["update"],
        platforms: ["cursor"],
      }),
    ]);
  });

  it("keeps mixed add and update in one group with both counts", () => {
    const groups = groupFileChangesByResource([
      {
        path: ".cursor/skills/ship/SKILL.md",
        type: "deleted",
        platform: "cursor",
        resource: { type: "skill", name: "ship" },
      },
      {
        path: ".claude/skills/ship/SKILL.md",
        type: "modified",
        platform: "claude-code",
        resource: { type: "skill", name: "ship" },
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].kinds).toEqual(["add", "update"]);
    expect(groups[0].platforms).toEqual(["claude-code", "cursor"]);
    expect(groups[0].singleton).toBe(false);
  });

  it("joins mixed destination kinds with a middle dot", () => {
    const [group] = groupFileChangesByResource([
      {
        path: ".cursor/skills/ship/SKILL.md",
        type: "deleted",
        platform: "cursor",
        resource: { type: "skill", name: "ship" },
      },
      {
        path: ".claude/skills/ship/SKILL.md",
        type: "modified",
        platform: "claude-code",
        resource: { type: "skill", name: "ship" },
      },
    ]);
    expect(fileChangeDestinationSummary(group)).toBe(
      "add → Cursor · update → Claude Code",
    );
  });

  it("summarizes destination kind without platforms", () => {
    const [group] = groupFileChangesByResource([
      {
        path: ".claude/skills/ship/SKILL.md",
        type: "deleted",
        resource: { type: "skill", name: "ship" },
      },
    ]);
    expect(fileChangeDestinationSummary(group)).toBe("add");
  });

  it("filters group children by kind and hides empty groups", () => {
    const groups = groupFileChangesByResource([
      {
        path: ".cursor/skills/ship/SKILL.md",
        type: "deleted",
        platform: "cursor",
        resource: { type: "skill", name: "ship" },
      },
      {
        path: ".claude/skills/ship/SKILL.md",
        type: "modified",
        platform: "claude-code",
        resource: { type: "skill", name: "ship" },
      },
      {
        path: ".claude/skills/old/SKILL.md",
        type: "added",
        platform: "claude-code",
        resource: { type: "skill", name: "old" },
      },
    ]);

    const addOnly = filterFileChangeGroups(groups, new Set(["add"]), "");
    expect(addOnly.map((group) => group.key)).toEqual(["skill:ship"]);
    expect(addOnly[0].changes).toHaveLength(1);
    expect(addOnly[0].changes[0].platform).toBe("cursor");
    expect(addOnly[0].singleton).toBe(true);

    const removeOnly = filterFileChangeGroups(groups, new Set(["remove"]), "");
    expect(removeOnly.map((group) => group.key)).toEqual(["skill:old"]);
  });

  it("keeps a group when the resource name matches even if paths do not", () => {
    const groups = groupFileChangesByResource([
      {
        path: ".claude/skills/ship/SKILL.md",
        type: "deleted",
        platform: "claude-code",
        resource: { type: "skill", name: "ship" },
      },
    ]);
    const byName = filterFileChangeGroups(groups, new Set(), "ship");
    expect(byName).toHaveLength(1);
    const byPath = filterFileChangeGroups(groups, new Set(), "SKILL.md");
    expect(byPath).toHaveLength(1);
    const miss = filterFileChangeGroups(groups, new Set(), "review");
    expect(miss).toHaveLength(0);
  });

  it("matches type:name search against the resource", () => {
    const groups = groupFileChangesByResource([
      {
        path: ".claude/skills/ship/SKILL.md",
        type: "deleted",
        platform: "claude-code",
        resource: { type: "skill", name: "ship" },
      },
      {
        path: ".claude/commands/ship.md",
        type: "deleted",
        platform: "claude-code",
        resource: { type: "command", name: "ship" },
      },
    ]);
    expect(
      filterFileChangeGroups(groups, new Set(), "skill:ship").map((group) => group.key),
    ).toEqual(["skill:ship"]);
  });
});
