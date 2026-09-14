import { describe, expect, it } from "bun:test";
import { flattenProfileResourceList } from "../../apps/desktop/src/lib/contents-diff.ts";
import {
  PROFILE_INVENTORY_SECTION_ORDER,
  filterProfileInventoryItems,
  partitionProfileInventory,
} from "../../apps/desktop/src/lib/profile-inventory.ts";
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
});
