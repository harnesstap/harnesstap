import { describe, expect, it } from "bun:test";
import { flattenProfileResourceList } from "../../apps/desktop/src/lib/contents-diff.ts";
import {
  PROFILE_INVENTORY_SECTION_ORDER,
  collectTypeTabAttention,
  countInventoryTypeTabs,
  filterProfileInventoryItems,
  inventoryMembershipCaption,
  partitionProfileInventory,
} from "../../apps/desktop/src/lib/profile-inventory.ts";
import {
  resourceTypeTabItemCount,
  resourceTypeTabPillsText,
  resourceTypeTabTooltip,
  visibleResourceTypeTabs,
} from "../../apps/desktop/src/lib/resource-type-tabs.ts";
import type {
  DriftFileChange,
  ProfileContents,
  ProfileContentsResource,
} from "../../apps/desktop/src/lib/types.ts";

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
