import { describe, expect, it } from "bun:test";
import { flattenProfileResourceList } from "../../apps/desktop/src/lib/contents-diff.ts";
import {
  PROFILE_INVENTORY_SECTION_ORDER,
  applyOptimisticInventoryMoves,
  collectTypeTabAttention,
  countInventoryTypeTabs,
  filterProfileInventoryItems,
  groupProfileInventoryByType,
  inventoryMembershipCaption,
  partitionProfileInventory,
  type ProfileInventoryItem,
  profileInventoryOpenTarget,
  planProfileDiskSnapshot,
  profileDiskSnapshotHasWork,
  settleInChunks,
} from "../../apps/desktop/src/lib/profile-inventory.ts";
import {
  resourceTypeTabItemCount,
  resourceTypeTabPillsText,
  resourceTypeTabTooltip,
  visibleResourceTypeTabs,
} from "../../apps/desktop/src/lib/resource-type-tabs.ts";
import { fileDiffHasContentChange } from "../../apps/desktop/src/lib/unified-diff.ts";
import type {
  DriftFileChange,
  ProfileContents,
  ProfileContentsResource,
} from "../../apps/desktop/src/lib/types.ts";
import { affectedResourcesForManagedFileDiff } from "../../src/services/scoped-file-content-delta.ts";

function contents(
  overrides: Partial<ProfileContents> = {},
): ProfileContents {
  return {
    plugins: [],
    stack_resource_count: 0,
    stack_summary: null,
    type_counts: {},
    resources: [],
    plugin_pins: [],
    mcp_servers: [],
    ...overrides,
  };
}

describe("PROFILE_INVENTORY_SECTION_ORDER", () => {
  it("lists Not in profile, then Inactive, then Active", () => {
    expect(PROFILE_INVENTORY_SECTION_ORDER).toEqual([
      "not_in_profile",
      "inactive",
      "active",
    ]);
  });
});

describe("groupProfileInventoryByType", () => {
  it("clusters items in type-tab order and folds plugin pins into Plugins", () => {
    const item = (type: string, name: string): ProfileInventoryItem => ({
      section: "active",
      key: `${type}:${name}`,
      type,
      label: name,
      resource: { type, name },
      drifted: false,
    });
    const groups = groupProfileInventoryByType([
      item("skill", "ship"),
      item("plugin_pin", "devx"),
      item("rule", "quiet"),
      item("plugin", "pack"),
      item("skill", "docs"),
    ]);
    expect(groups.map((group) => group.type)).toEqual(["plugin", "skill", "rule"]);
    expect(groups[0]?.items.map((row) => row.label)).toEqual(["devx", "pack"]);
    expect(groups[1]?.items.map((row) => row.label)).toEqual(["ship", "docs"]);
  });
});

describe("partitionProfileInventory", () => {
  const profile = contents({
    resources: [
      { type: "skill", name: "ship", id: "ship-id", source: "skills/ship/SKILL.md" },
      { type: "rule", name: "quiet", id: "quiet-id", source: "rules/quiet.md" },
    ],
    type_counts: { skill: 1, rule: 1 },
    stack_resource_count: 2,
  });
  const live = contents({
    resources: [
      { type: "skill", name: "ship", id: "ship-id", source: "skills/ship/SKILL.md" },
      { type: "command", name: "extra", source: "commands/extra.md" },
    ],
    type_counts: { skill: 1, command: 1 },
    stack_resource_count: 2,
  });

  it("lists the design-doc plugin, not its nested skill, unless that skill is only on the profile", () => {
    const profile = contents({
      plugins: [
        {
          id: "global-default",
          name: "global default",
          version: "1.0.0",
          resources: [
            { type: "skill", name: "design-doc" },
            { type: "skill", name: "my-notes" },
          ],
        },
        {
          id: "design-doc",
          name: "design-doc",
          version: "1.2.0",
          resources: [{ type: "skill", name: "design-doc" }],
        },
      ],
      resources: [
        { type: "skill", name: "design-doc" },
        { type: "skill", name: "my-notes" },
      ],
      type_counts: { plugin: 2, skill: 2 },
      stack_resource_count: 2,
    });
    const live = contents({
      plugins: [
        {
          id: "design-doc",
          name: "design-doc",
          version: "1.2.0",
          resources: [{ type: "skill", name: "design-doc" }],
        },
      ],
      resources: [{ type: "skill", name: "design-doc" }],
      type_counts: { plugin: 1, skill: 1 },
      stack_resource_count: 1,
    });
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(profile, {
        selectedProfile: "global default",
      }),
      liveRows: flattenProfileResourceList(live, {
        selectedProfile: "global default",
      }),
      notStaged: [
        {
          type: "skill",
          name: "design-doc",
          not_staged_kind: "add",
        },
        {
          type: "command",
          name: "extra",
          not_staged_kind: "add",
        },
      ],
    });
    const all = [...parts.notInProfile, ...parts.inactive, ...parts.active];
    expect(all.map((row) => [row.type, row.resource.name])).toEqual([
      ["command", "extra"],
      ["skill", "my-notes"],
      ["plugin", "design-doc"],
    ]);
    expect(filterProfileInventoryItems(all, "", "skill").map((row) => row.resource.name))
      .toEqual(["my-notes"]);
    expect(filterProfileInventoryItems(all, "", "plugin").map((row) => row.resource.name))
      .toEqual(["design-doc"]);
    const counts = countInventoryTypeTabs(all);
    expect(resourceTypeTabItemCount("skill", counts)).toBe(1);
    expect(resourceTypeTabItemCount("plugin", counts)).toBe(1);
    expect(resourceTypeTabPillsText("skill", counts)).toBe("1 Skills");
    expect(parts.notInProfile.map((row) => row.resource.name)).toEqual(["extra"]);
    expect(parts.active.map((row) => row.resource.name)).toEqual(["design-doc"]);
    expect(parts.inactive.map((row) => row.resource.name)).toEqual(["my-notes"]);
    expect(all.every((row) => row.pluginName === undefined)).toBe(true);
  });

  it("splits harness extras, in-profile-off, and in-profile-on", () => {
    const notStaged: ProfileContentsResource[] = [
      {
        type: "command",
        name: "extra",
        source: "commands/extra.md",
        not_staged_kind: "add",
      },
      {
        type: "skill",
        name: "ship",
        id: "ship-id",
        source: "skills/ship/SKILL.md",
        not_staged_kind: "update",
      },
    ];
    const fileChanges: DriftFileChange[] = [
      {
        path: "skills/ship/SKILL.md",
        type: "modified",
        resource: { type: "skill", name: "ship" },
      },
    ];
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(profile, { selectedProfile: "work" }),
      liveRows: flattenProfileResourceList(live, { selectedProfile: "work" }),
      notStaged,
      fileChanges,
    });

    expect(parts.notInProfile.map((row) => row.resource.name)).toEqual(["extra"]);
    expect(parts.inactive.map((row) => row.resource.name)).toEqual(["quiet"]);
    expect(parts.active.map((row) => row.resource.name)).toEqual(["ship"]);
    expect(parts.active[0]?.drifted).toBe(true);
    expect(parts.active[0]?.driftChange?.path).toBe("skills/ship/SKILL.md");
    expect([...parts.notInProfile, ...parts.inactive, ...parts.active].map((row) => row.section))
      .toEqual(["not_in_profile", "inactive", "active"]);
  });

  it("attaches View-changes file diffs to Active MCP and subagent chips", () => {
    const stacked = contents({
      resources: [
        {
          type: "mcp_server",
          name: "alpha",
          source: "~/.cursor/mcp.json",
        },
        {
          type: "mcp_server",
          name: "beta",
          source: "manual",
        },
        {
          type: "agent",
          name: "helper",
          source: "agents/helper.toml",
        },
      ],
      type_counts: { mcp_server: 2, agent: 1 },
      stack_resource_count: 3,
    });
    const liveStacked = contents({
      resources: stacked.resources,
      type_counts: stacked.type_counts,
      stack_resource_count: 3,
    });
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      liveRows: flattenProfileResourceList(liveStacked, { selectedProfile: "work" }),
      notStaged: [],
      fileChanges: [
        {
          path: ".cursor/mcp.json",
          type: "modified",
          affected_resources: [
            { type: "mcp_server", name: "alpha" },
            { type: "mcp_server", name: "beta" },
          ],
        },
        { path: ".codex/agents/helper.toml", type: "modified" },
      ],
    });

    const alpha = parts.active.find((row) => row.resource.name === "alpha");
    const beta = parts.active.find((row) => row.resource.name === "beta");
    const helper = parts.active.find((row) => row.resource.name === "helper");
    expect(alpha?.drifted).toBe(true);
    expect(alpha?.driftChange?.path).toBe(".cursor/mcp.json");
    expect(beta?.drifted).toBe(true);
    expect(beta?.driftChange?.path).toBe(".cursor/mcp.json");
    expect(helper?.drifted).toBe(true);
    expect(helper?.driftChange?.path).toBe(".codex/agents/helper.toml");
  });

  it("hides View changes and yellow when MCP scoped diff on a shared file is empty", () => {
    const stacked = contents({
      resources: [
        {
          type: "mcp_server",
          name: "devel",
          source: "~/.cursor/mcp.json",
        },
      ],
      type_counts: { mcp_server: 1 },
      stack_resource_count: 1,
    });
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      liveRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      notStaged: [
        {
          type: "mcp_server",
          name: "devel",
          source: "~/.cursor/mcp.json",
          not_staged_kind: "update",
        },
      ],
      fileChanges: [
        {
          path: ".claude.json",
          type: "modified",
          affected_resources: [{ type: "mcp_server", name: "other" }],
        },
      ],
    });

    expect(parts.active[0]?.drifted).toBe(false);
    expect(parts.active[0]?.driftChange).toBeUndefined();
  });

  it("hides View changes and yellow when a skill or subagent scoped diff is +0 -0", () => {
    const skillPath = ".claude/skills/ubiquitous-language/SKILL.md";
    const agentPath = ".claude/agents/code-reviewer.md";
    const skillBody = "---\nname: ubiquitous-language\n---\n\n# ubiquitous-language";
    const agentBody = "---\nname: code-reviewer\n---\n\nReview the diff.";
    const skillExpected = skillBody;
    const skillCurrent = `${skillBody}\n`;
    const agentExpected = agentBody;
    const agentCurrent = `${agentBody}\n`;

    expect(fileDiffHasContentChange(skillPath, skillCurrent, skillExpected)).toBe(false);
    expect(fileDiffHasContentChange(agentPath, agentCurrent, agentExpected)).toBe(false);

    const skillAffected = affectedResourcesForManagedFileDiff({
      path: skillPath,
      expected: skillExpected,
      current: skillCurrent,
    });
    const agentAffected = affectedResourcesForManagedFileDiff({
      path: agentPath,
      expected: agentExpected,
      current: agentCurrent,
    });
    expect(skillAffected).toEqual([]);
    expect(agentAffected).toEqual([]);

    const stacked = contents({
      resources: [
        {
          type: "skill",
          name: "ubiquitous-language",
          source: `~/${skillPath}`,
        },
        {
          type: "agent",
          name: "code-reviewer",
          source: `~/${agentPath}`,
        },
      ],
      type_counts: { skill: 1, agent: 1 },
      stack_resource_count: 2,
    });
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      liveRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      notStaged: [
        {
          type: "skill",
          name: "ubiquitous-language",
          source: `~/${skillPath}`,
          not_staged_kind: "update",
        },
        {
          type: "agent",
          name: "code-reviewer",
          source: `~/${agentPath}`,
          not_staged_kind: "update",
        },
      ],
      fileChanges: [
        {
          path: skillPath,
          type: "modified",
          resource: { type: "skill", name: "ubiquitous-language" },
          affected_resources: skillAffected,
        },
        {
          path: agentPath,
          type: "modified",
          resource: { type: "agent", name: "code-reviewer" },
          affected_resources: agentAffected,
        },
      ],
    });

    const skill = parts.active.find((row) => row.resource.name === "ubiquitous-language");
    const agent = parts.active.find((row) => row.resource.name === "code-reviewer");
    expect(skill?.drifted).toBe(false);
    expect(skill?.driftChange).toBeUndefined();
    expect(agent?.drifted).toBe(false);
    expect(agent?.driftChange).toBeUndefined();
  });

  it("attaches View changes when MCP drift is on another harness config than the chip source", () => {
    const stacked = contents({
      resources: [
        {
          type: "mcp_server",
          name: "devel",
          source: "~/.cursor/mcp.json",
        },
      ],
      type_counts: { mcp_server: 1 },
      stack_resource_count: 1,
    });
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      liveRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      notStaged: [
        {
          type: "mcp_server",
          name: "devel",
          source: "~/.cursor/mcp.json",
          not_staged_kind: "update",
        },
      ],
      fileChanges: [
        {
          path: ".claude.json",
          type: "modified",
          affected_resources: [{ type: "mcp_server", name: "devel" }],
        },
      ],
    });

    expect(parts.active[0]?.drifted).toBe(true);
    expect(parts.active[0]?.driftChange?.path).toBe(".claude.json");
  });

  it("attaches View changes for portable MCP chips onto Codex aggregate config", () => {
    const stacked = contents({
      resources: [{ type: "mcp_server", name: "devel", source: "manual" }],
      type_counts: { mcp_server: 1 },
      stack_resource_count: 1,
    });
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      liveRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      notStaged: [],
      fileChanges: [
        {
          path: ".codex/config.toml",
          type: "modified",
          affected_resources: [{ type: "mcp_server", name: "devel" }],
        },
      ],
    });

    expect(parts.active[0]?.drifted).toBe(true);
    expect(parts.active[0]?.driftChange?.path).toBe(".codex/config.toml");
  });

  it("attaches View changes for Active MCP and subagent chips drifted only via not-staged updates", () => {
    const stacked = contents({
      resources: [
        {
          type: "mcp_server",
          name: "devel",
          source: "manual",
        },
        {
          type: "agent",
          name: "Researcher",
          source: "manual",
        },
      ],
      type_counts: { mcp_server: 1, agent: 1 },
      stack_resource_count: 2,
    });
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      liveRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      notStaged: [
        {
          type: "mcp_server",
          name: "devel",
          source: "~/.cursor/mcp.json",
          filesystem_path: "~/.cursor/mcp.json",
          not_staged_kind: "update",
        },
        {
          type: "agent",
          name: "Researcher",
          source: "~/.claude/agents/researcher.md",
          filesystem_path: "~/.claude/agents/researcher.md",
          not_staged_kind: "update",
        },
      ],
    });

    const mcp = parts.active.find((row) => row.resource.name === "devel");
    const agent = parts.active.find((row) => row.resource.name === "Researcher");
    expect(mcp?.drifted).toBe(false);
    expect(mcp?.driftChange).toBeUndefined();
    expect(agent?.drifted).toBe(false);
    expect(agent?.driftChange).toBeUndefined();
  });

  it("hides View changes when a permission sibling changed the shared settings file", () => {
    const stacked = contents({
      resources: [
        {
          type: "permission",
          name: "allow-Bash(jk:*)",
          source: "~/.claude/settings.json",
        },
      ],
      type_counts: { permission: 1 },
      stack_resource_count: 1,
    });
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      liveRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      notStaged: [
        {
          type: "permission",
          name: "allow-Bash(jk:*)",
          source: "~/.claude/settings.json",
          not_staged_kind: "update",
        },
      ],
      fileChanges: [
        {
          path: ".claude/settings.json",
          type: "modified",
          affected_resources: [{ type: "permission", name: "allow-Read" }],
        },
      ],
    });

    expect(parts.active[0]?.drifted).toBe(false);
    expect(parts.active[0]?.driftChange).toBeUndefined();
  });

  it("attaches View changes when a subagent chip name differs from the agent filename", () => {
    const stacked = contents({
      resources: [
        {
          type: "agent",
          name: "Researcher",
          source: "manual",
        },
      ],
      type_counts: { agent: 1 },
      stack_resource_count: 1,
    });
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      liveRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      notStaged: [],
      fileChanges: [{ path: ".claude/agents/researcher.md", type: "modified" }],
    });

    expect(parts.active[0]?.drifted).toBe(true);
    expect(parts.active[0]?.driftChange?.path).toBe(".claude/agents/researcher.md");
  });

  it("attaches View changes for permission and hook chips onto Claude settings.json", () => {
    const stacked = contents({
      resources: [
        {
          type: "permission",
          name: "allow-Bash(jk:*)",
          source: "~/.claude/settings.json",
        },
        {
          type: "hook",
          name: "SessionStart-1",
          source: "manual",
        },
      ],
      type_counts: { permission: 1, hook: 1 },
      stack_resource_count: 2,
    });
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      liveRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      notStaged: [],
      fileChanges: [
        {
          path: ".claude/settings.json",
          type: "modified",
          affected_resources: [
            { type: "permission", name: "allow-Bash(jk:*)" },
            { type: "hook", name: "SessionStart-1" },
          ],
        },
      ],
    });

    const permission = parts.active.find((row) => row.resource.name === "allow-Bash(jk:*)");
    const hook = parts.active.find((row) => row.resource.name === "SessionStart-1");
    expect(permission?.drifted).toBe(true);
    expect(permission?.driftChange?.path).toBe(".claude/settings.json");
    expect(hook?.drifted).toBe(true);
    expect(hook?.driftChange?.path).toBe(".claude/settings.json");
  });

  it("does not attach a sibling subagent file to the clicked chip", () => {
    const stacked = contents({
      resources: [
        { type: "agent", name: "code-reviewer", source: "manual" },
        { type: "agent", name: "planner", source: "manual" },
      ],
      type_counts: { agent: 2 },
      stack_resource_count: 2,
    });
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      liveRows: flattenProfileResourceList(stacked, { selectedProfile: "work" }),
      notStaged: [
        {
          type: "agent",
          name: "code-reviewer",
          source: "manual",
          filesystem_path: "/Users/christophe.oudar/.claude/agents/planner.md",
          not_staged_kind: "update",
        },
        {
          type: "agent",
          name: "planner",
          source: "manual",
          filesystem_path: "/Users/christophe.oudar/.claude/agents/planner.md",
          not_staged_kind: "update",
        },
      ],
      fileChanges: [{ path: ".claude/agents/planner.md", type: "modified" }],
    });

    const reviewer = parts.active.find((row) => row.resource.name === "code-reviewer");
    const planner = parts.active.find((row) => row.resource.name === "planner");
    expect(reviewer?.drifted).toBe(false);
    expect(reviewer?.driftChange).toBeUndefined();
    expect(planner?.drifted).toBe(true);
    expect(planner?.driftChange?.path).toBe(".claude/agents/planner.md");
  });

  it("attaches a scoped MCP file diff on Not in profile chips", () => {
    const parts = partitionProfileInventory({
      profileRows: [],
      liveRows: flattenProfileResourceList(
        contents({
          resources: [{ type: "mcp_server", name: "extra", source: "~/.cursor/mcp.json" }],
        }),
        { selectedProfile: "work" },
      ),
      notStaged: [
        {
          type: "mcp_server",
          name: "extra",
          source: "~/.cursor/mcp.json",
          not_staged_kind: "add",
        },
      ],
      fileChanges: [
        {
          path: ".cursor/mcp.json",
          type: "modified",
          affected_resources: [{ type: "mcp_server", name: "extra" }],
        },
      ],
    });

    expect(parts.notInProfile).toHaveLength(1);
    expect(parts.notInProfile[0]?.drifted).toBe(false);
    expect(parts.notInProfile[0]?.driftChange?.path).toBe(".cursor/mcp.json");
  });

  it("does not invent a View-changes path for fingerprint updates without apply file changes", () => {
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(profile, { selectedProfile: "work" }),
      liveRows: flattenProfileResourceList(live, { selectedProfile: "work" }),
      notStaged: [
        {
          type: "skill",
          name: "ship",
          id: "ship-id",
          source: "~/.claude/skills/ship/SKILL.md",
          not_staged_kind: "update",
        },
      ],
    });

    expect(parts.active[0]?.resource.name).toBe("ship");
    expect(parts.active[0]?.drifted).toBe(false);
    expect(parts.active[0]?.driftChange).toBeUndefined();
  });

  it("labels hook chips as Event: script basename", () => {
    const hook: ProfileContentsResource = {
      type: "hook",
      name: "SessionStart-1",
      source: "~/.claude/settings.json",
      hook: {
        event: "sessionStart",
        script: "~/.claude/hooks/ponytail-activate.js",
      },
    };
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(
        contents({ resources: [hook], type_counts: { hook: 1 }, stack_resource_count: 1 }),
      ),
      liveRows: [],
      notStaged: [],
    });
    expect(parts.inactive.map((row) => row.label)).toEqual([
      "SessionStart: ponytail-activate.js",
    ]);
  });
});

describe("filterProfileInventoryItems", () => {
  it("respects search and type tab together", () => {
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(
        contents({
          resources: [
            { type: "skill", name: "alpha" },
            { type: "skill", name: "beta" },
            { type: "rule", name: "gamma" },
          ],
        }),
        {},
      ),
      liveRows: flattenProfileResourceList(
        contents({
          resources: [{ type: "skill", name: "alpha" }],
        }),
        {},
      ),
      notStaged: [{ type: "command", name: "delta", not_staged_kind: "add" }],
    });
    const all = [...parts.notInProfile, ...parts.inactive, ...parts.active];
    expect(filterProfileInventoryItems(all, "a", null).map((row) => row.resource.name)).toEqual([
      "delta",
      "beta",
      "gamma",
      "alpha",
    ]);
    expect(
      filterProfileInventoryItems(all, "", "skill").map((row) => row.resource.name),
    ).toEqual(["beta", "alpha"]);
    expect(
      filterProfileInventoryItems(all, "a", "skill").map((row) => row.resource.name),
    ).toEqual(["beta", "alpha"]);
  });

  it("includes plugin pins on the Plugins tab", () => {
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(
        contents({
          plugins: [{ id: "pkg", name: "pkg", version: "1.0.0" }],
          plugin_pins: [{ ref: "slack@claude-plugins", version_constraint: "latest" }],
          resources: [{ type: "skill", name: "ship" }],
        }),
        {},
      ),
      liveRows: flattenProfileResourceList(
        contents({
          plugins: [{ id: "pkg", name: "pkg", version: "1.0.0" }],
        }),
        {},
      ),
      notStaged: [],
    });
    const all = [...parts.notInProfile, ...parts.inactive, ...parts.active];
    expect(
      filterProfileInventoryItems(all, "", "plugin").map((row) => row.type).sort(),
    ).toEqual(["plugin", "plugin_pin"]);
    expect(filterProfileInventoryItems(all, "", "plugin_pin")).toEqual([]);
  });

  it("keeps type-tab counts on the same search scope as the list", () => {
    const pins = [
      { ref: "other/alpha", version_constraint: "1" },
      { ref: "other/bravo", version_constraint: "1" },
      { ref: "other/charlie", version_constraint: "1" },
      { ref: "claude-plugins/devx", version_constraint: "1" },
    ];
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(
        contents({
          plugin_pins: pins,
          resources: [{ type: "skill", name: "ship" }],
        }),
        {},
      ),
      liveRows: flattenProfileResourceList(
        contents({
          plugin_pins: pins,
          resources: [{ type: "skill", name: "ship" }],
        }),
        {},
      ),
      notStaged: [{ type: "command", name: "extra", not_staged_kind: "add" }],
    });
    const all = [...parts.notInProfile, ...parts.inactive, ...parts.active];
    const unfiltered = countInventoryTypeTabs(all);
    expect(resourceTypeTabItemCount("plugin", unfiltered)).toBe(4);
    expect(resourceTypeTabPillsText("plugin", unfiltered)).toBe("4 Plugins");
    expect(resourceTypeTabItemCount("all", unfiltered)).toBe(6);

    const searched = filterProfileInventoryItems(all, "Devx", null);
    expect(searched.map((row) => row.resource.name)).toEqual([
      "claude-plugins/devx",
    ]);
    const counts = countInventoryTypeTabs(searched);
    expect(resourceTypeTabItemCount("plugin", counts)).toBe(1);
    expect(resourceTypeTabItemCount("skill", counts)).toBe(0);
    expect(resourceTypeTabItemCount("command", counts)).toBe(0);
    expect(resourceTypeTabItemCount("all", counts)).toBe(1);
    expect(resourceTypeTabPillsText("plugin", counts)).toBe("1 Plugins");
    const disableOpts = { includeAll: true, emptyMode: "disable" as const };
    expect(resourceTypeTabTooltip("skill", counts, disableOpts)).toBe(
      "No Skills found",
    );
    const tabs = visibleResourceTypeTabs(counts, disableOpts);
    expect(tabs).toContain("plugin");
    expect(tabs).toContain("skill");
    expect(tabs).not.toContain("plugin_ref");
    expect(tabs).not.toContain("plugin_pin");
    expect(collectTypeTabAttention(searched).size).toBe(0);
  });
});

describe("collectTypeTabAttention", () => {
  it("counts Not in profile and Inactive, not drifted Active, and honors search", () => {
    const parts = partitionProfileInventory({
      profileRows: flattenProfileResourceList(
        contents({
          resources: [
            { type: "skill", name: "ship", source: "skills/ship/SKILL.md" },
            { type: "rule", name: "quiet" },
          ],
        }),
        {},
      ),
      liveRows: flattenProfileResourceList(
        contents({
          resources: [
            { type: "skill", name: "ship", source: "skills/ship/SKILL.md" },
            { type: "command", name: "extra" },
          ],
        }),
        {},
      ),
      notStaged: [
        { type: "command", name: "extra", not_staged_kind: "add" },
        {
          type: "skill",
          name: "ship",
          source: "skills/ship/SKILL.md",
          not_staged_kind: "update",
        },
      ],
      fileChanges: [
        {
          path: "skills/ship/SKILL.md",
          type: "modified",
          resource: { type: "skill", name: "ship" },
        },
      ],
    });
    const all = [...parts.notInProfile, ...parts.inactive, ...parts.active];
    const attention = collectTypeTabAttention(all);
    expect(attention.get("command")).toEqual({ toAdd: 1, inactive: 0 });
    expect(attention.get("rule")).toEqual({ toAdd: 0, inactive: 1 });
    expect(attention.get("skill")).toBeUndefined();
    expect(attention.get("all")).toEqual({ toAdd: 1, inactive: 1 });

    const searched = filterProfileInventoryItems(all, "quiet", null);
    const filteredAttention = collectTypeTabAttention(searched);
    expect(filteredAttention.get("all")).toEqual({ toAdd: 0, inactive: 1 });
    expect(filteredAttention.get("rule")).toEqual({ toAdd: 0, inactive: 1 });
    expect(filteredAttention.get("command")).toBeUndefined();
  });
});

describe("inventoryMembershipCaption", () => {
  it("hides in {this profile} and keeps a nested plugin owner", () => {
    expect(inventoryMembershipCaption("global default", "global default")).toBeNull();
    expect(inventoryMembershipCaption("design-doc", "global default")).toBe("in design-doc");
    expect(inventoryMembershipCaption(undefined, "global default")).toBeNull();
  });
});

describe("profileInventoryOpenTarget", () => {
  it("opens plugin package membership by name, not the plugin ULID", () => {
    const target = profileInventoryOpenTarget({
      type: "plugin",
      label: "devx",
      resource: {
        type: "plugin",
        name: "devx",
        id: "01KZQS7T5K5WS4XM692C5GV8JC",
        source: "01KZQS7T5K5WS4XM692C5GV8JC",
      },
    });
    expect(target).toEqual({ kind: "plugin-package", name: "devx" });
  });

  it("keeps nested plugin contents and other rows as library resources", () => {
    const nested = profileInventoryOpenTarget({
      type: "skill",
      label: "ship",
      pluginId: "01KZQS7T5K5WS4XM692C5GV8JC",
      resource: {
        type: "skill",
        name: "ship",
        id: "skill-id",
        source: "skills/ship/SKILL.md",
      },
    });
    expect(nested.kind).toBe("resource");
    if (nested.kind === "resource") {
      expect(nested.resource.id).toBe("skill-id");
    }

    const pin = profileInventoryOpenTarget({
      type: "plugin_pin",
      label: "devx@1",
      resource: {
        type: "plugin_pin",
        name: "devx",
        id: "devx@1",
        source: "^1.0.0",
      },
    });
    expect(pin.kind).toBe("resource");
  });
});

describe("optimistic inventory moves", () => {
  it("relocates a row by membership key", () => {
    const item = {
      section: "not_in_profile" as const,
      key: "k",
      type: "skill",
      label: "ship",
      resource: { type: "skill", name: "ship" },
      drifted: false,
    };
    const moved = applyOptimisticInventoryMoves(
      [item],
      new Map([["skill:ship", "inactive"]]),
    );
    expect(moved[0]?.section).toBe("inactive");
  });
});

describe("settleInChunks", () => {
  it("runs workers in chunks of four and reports progress", async () => {
    const seen: number[] = [];
    const results = await settleInChunks(
      [1, 2, 3, 4, 5],
      4,
      async (value) => {
        seen.push(value);
      },
      (done) => {
        seen.push(done + 100);
      },
    );
    expect(results).toHaveLength(5);
    expect(seen.filter((value) => value < 100)).toEqual([1, 2, 3, 4, 5]);
    expect(seen.filter((value) => value >= 100)).toEqual([104, 105]);
  });
});

describe("planProfileDiskSnapshot", () => {
  it("adds not-in-profile, removes inactive, and commits drifted plus file paths", () => {
    const skill = { type: "skill", name: "ship" };
    const extra = { type: "rule", name: "lint" };
    const gone = { type: "command", name: "old" };
    const plan = planProfileDiskSnapshot(
      {
        notInProfile: [
          {
            section: "not_in_profile",
            key: "a",
            type: "rule",
            label: "lint",
            resource: extra,
            drifted: false,
          },
        ],
        inactive: [
          {
            section: "inactive",
            key: "b",
            type: "command",
            label: "old",
            resource: gone,
            pluginId: "plug-1",
            drifted: false,
          },
        ],
        active: [
          {
            section: "active",
            key: "c",
            type: "skill",
            label: "ship",
            resource: { ...skill, source: "skills/ship/SKILL.md" },
            drifted: true,
            driftChange: {
              path: "skills/ship/SKILL.md",
              type: "modified",
              resource: skill,
            },
          },
        ],
      },
      [{ path: "mcp.json", type: "modified" }],
    );
    expect(plan.toAdd).toEqual([extra]);
    expect(plan.toRemove).toEqual([{ resource: gone, pluginId: "plug-1" }]);
    expect(plan.commitPaths).toEqual(["skills/ship/SKILL.md", "mcp.json"]);
    expect(profileDiskSnapshotHasWork(plan)).toBe(true);
    expect(
      profileDiskSnapshotHasWork({ toAdd: [], toRemove: [], commitPaths: [] }),
    ).toBe(false);
  });
});
