import { describe, expect, it } from "bun:test";
import { parseHarnessInventory } from "../../apps/desktop/src/lib/api/harnesses.ts";
import {
  availableHarnesses,
  canRemoveHarness,
  configuredHarnesses,
  type DiskPresence,
  defaultProposalChoice,
  detectProposal,
  diskPresenceLabel,
  filterHarnessLocations,
  groupHarnessLocationsByType,
  type HarnessEntry,
  type HarnessInventory,
  type HarnessLocation,
  type HarnessResourceRow,
  harnessesViewReducer,
  harnessId,
  harnessMarketplaceFilterOptions,
  harnessOriginFilterOptions,
  harnessResourceMarketplace,
  harnessResourceBadgeLabel,
  harnessResourceDisplayName,
  harnessDuplicatePluginNames,
  harnessSummary,
  harnessSupportsLabel,
  initialHarnessesViewState,
  locationRelationLabel,
  locationSectionOwner,
  removalCopy,
  resourceDetailTargetFor,
  selectionFrom,
  selectionWith,
  truncateResourceBadgeName,
} from "../../apps/desktop/src/lib/harness-inventory.ts";

const CLAUDE = harnessId("claude-code");
const CURSOR = harnessId("cursor");
const CODEX = harnessId("codex");
const GOOSE = harnessId("goose");

function row(
  type: string,
  name: string,
  source: string,
  extra: Partial<Pick<HarnessResourceRow, "id" | "namespace" | "origin_kind" | "origin_ref">> = {},
): HarnessResourceRow {
  return {
    id: extra.id ?? `${type}-${extra.origin_ref ?? name}`,
    type,
    name,
    description: "",
    source,
    origin_kind: extra.origin_kind ?? null,
    namespace: extra.namespace ?? null,
    origin_ref: extra.origin_ref ?? null,
  };
}

function entry(
  id: string,
  disk: DiskPresence,
  options: { supported?: boolean; locations?: readonly HarnessLocation[] } = {},
): HarnessEntry {
  return {
    id: harnessId(id),
    name: id,
    supported: options.supported ?? true,
    supports: [],
    disk,
    locations: options.locations ?? [],
  };
}

function location(
  path: string,
  surfaces: HarnessLocation["surfaces"],
  onDisk: boolean,
  resources: readonly HarnessResourceRow[],
  extra: Partial<Pick<HarnessLocation, "relation" | "relatedFrom">> = {},
): HarnessLocation {
  return {
    path,
    surfaces,
    onDisk,
    relation: extra.relation ?? "native",
    relatedFrom: extra.relatedFrom ?? null,
    resources,
  };
}

const SKILLS: HarnessLocation = location(
  "~/.claude/skills/",
  ["skills"],
  true,
  [
    row("skill", "alpha", "~/.claude/skills/alpha/SKILL.md"),
    row("skill", "beta", "~/.claude/skills/beta/SKILL.md"),
  ],
);

const SETTINGS: HarnessLocation = location(
  "~/.claude/settings.json",
  ["permissions", "hooks", "settings"],
  true,
  [
    row("permission", "alpha-allow", "~/.claude/settings.json"),
    row("hook", "lint", "~/.claude/settings.json"),
  ],
);

const RULES: HarnessLocation = location("~/.claude/rules/", ["rules"], false, []);

const CLAUDE_ENTRY = entry("claude-code", "detected", {
  locations: [SKILLS, RULES, SETTINGS],
});

describe("selectionWith", () => {
  const catalog = [CLAUDE_ENTRY, entry("cursor", "absent"), entry("codex", "detected")];

  it("add on a null selection makes that harness main", () => {
    expect(selectionWith(null, catalog, { kind: "add", id: CLAUDE })).toEqual({
      kind: "changed",
      next: { main: CLAUDE, aliases: [] },
      added: [CLAUDE],
      removed: [],
      promotedMain: null,
    });
  });

  it("a second add becomes an alias", () => {
    expect(
      selectionWith({ main: CLAUDE, aliases: [] }, catalog, { kind: "add", id: CURSOR }),
    ).toEqual({
      kind: "changed",
      next: { main: CLAUDE, aliases: [CURSOR] },
      added: [CURSOR],
      removed: [],
      promotedMain: null,
    });
  });

  it("adding a configured id is unchanged", () => {
    expect(
      selectionWith({ main: CLAUDE, aliases: [CURSOR] }, catalog, { kind: "add", id: CURSOR }),
    ).toEqual({ kind: "unchanged" });
  });

  it("removing main promotes the first alias", () => {
    expect(
      selectionWith({ main: CLAUDE, aliases: [CURSOR, CODEX] }, catalog, {
        kind: "remove",
        id: CLAUDE,
      }),
    ).toEqual({
      kind: "changed",
      next: { main: CURSOR, aliases: [CODEX] },
      added: [],
      removed: [CLAUDE],
      promotedMain: CURSOR,
    });
  });

  it("removing an alias keeps main", () => {
    expect(
      selectionWith({ main: CLAUDE, aliases: [CURSOR, CODEX] }, catalog, {
        kind: "remove",
        id: CODEX,
      }),
    ).toEqual({
      kind: "changed",
      next: { main: CLAUDE, aliases: [CURSOR] },
      added: [],
      removed: [CODEX],
      promotedMain: null,
    });
  });

  it("removing the only harness is rejected", () => {
    expect(
      selectionWith({ main: CLAUDE, aliases: [] }, catalog, { kind: "remove", id: CLAUDE }),
    ).toEqual({ kind: "rejected", reason: "would-empty" });
  });

  it("removing an unconfigured id is unchanged", () => {
    expect(
      selectionWith({ main: CLAUDE, aliases: [] }, catalog, { kind: "remove", id: CURSOR }),
    ).toEqual({ kind: "unchanged" });
  });

  it("rejects ids the catalog does not know", () => {
    expect(
      selectionWith({ main: CLAUDE, aliases: [] }, catalog, { kind: "add", id: GOOSE }),
    ).toEqual({ kind: "rejected", reason: "unknown-harness" });
  });

  it("make-main swaps roles and keeps alias order", () => {
    expect(
      selectionWith({ main: CLAUDE, aliases: [CURSOR, CODEX] }, catalog, {
        kind: "make-main",
        id: CODEX,
      }),
    ).toEqual({
      kind: "changed",
      next: { main: CODEX, aliases: [CLAUDE, CURSOR] },
      added: [],
      removed: [],
      promotedMain: null,
    });
  });

  it("make-main on the current main is unchanged", () => {
    expect(
      selectionWith({ main: CLAUDE, aliases: [CURSOR] }, catalog, {
        kind: "make-main",
        id: CLAUDE,
      }),
    ).toEqual({ kind: "unchanged" });
  });

  it("apply-proposal can swap the sole harness in one change", () => {
    expect(
      selectionWith({ main: CURSOR, aliases: [] }, catalog, {
        kind: "apply-proposal",
        add: [CLAUDE],
        remove: [CURSOR],
      }),
    ).toEqual({
      kind: "changed",
      next: { main: CLAUDE, aliases: [] },
      added: [CLAUDE],
      removed: [CURSOR],
      promotedMain: CLAUDE,
    });
  });

  it("apply-proposal that would empty the list is rejected", () => {
    expect(
      selectionWith({ main: CURSOR, aliases: [] }, catalog, {
        kind: "apply-proposal",
        add: [],
        remove: [CURSOR],
      }),
    ).toEqual({ kind: "rejected", reason: "would-empty" });
  });

  it("is idempotent: the same change on its result is unchanged", () => {
    const change = { kind: "apply-proposal", add: [CODEX], remove: [CURSOR] } as const;
    const first = selectionWith({ main: CLAUDE, aliases: [CURSOR] }, catalog, change);
    if (first.kind !== "changed") throw new Error(`expected changed, got ${first.kind}`);

    expect(first.next).toEqual({ main: CLAUDE, aliases: [CODEX] });
    expect(selectionWith(first.next, catalog, change)).toEqual({ kind: "unchanged" });
  });
});

describe("detectProposal", () => {
  it("adds detected unconfigured, removes configured absent, skips shared-only", () => {
    const codex = entry("codex", "detected");
    const cursor = entry("cursor", "absent");
    const goose = entry("goose", "shared-only");
    const inventory: HarnessInventory = {
      selection: { main: CLAUDE, aliases: [CURSOR, GOOSE] },
      catalog: [CLAUDE_ENTRY, cursor, codex, goose],
    };

    const proposal = detectProposal(inventory);

    expect(proposal).toEqual({ add: [codex], remove: [cursor] });
    expect([...defaultProposalChoice(proposal)]).toEqual([CODEX]);
  });

  it("is empty when saved harnesses match the disk", () => {
    expect(
      detectProposal({
        selection: { main: CLAUDE, aliases: [] },
        catalog: [CLAUDE_ENTRY, entry("cursor", "absent")],
      }),
    ).toEqual({ add: [], remove: [] });
  });
});

describe("selection helpers", () => {
  it("selectionFrom drops main and duplicates from aliases", () => {
    expect(selectionFrom(CLAUDE, [CURSOR, CLAUDE, CURSOR, CODEX])).toEqual({
      main: CLAUDE,
      aliases: [CURSOR, CODEX],
    });
  });

  it("configuredHarnesses follows saved order and drops unknown ids", () => {
    const cursor = entry("cursor", "absent");
    expect(
      configuredHarnesses({
        selection: { main: CURSOR, aliases: [GOOSE, CLAUDE] },
        catalog: [CLAUDE_ENTRY, cursor],
      }).map((item) => item.id),
    ).toEqual([CURSOR, CLAUDE]);
  });

  it("availableHarnesses lists detected first, then names", () => {
    const named = (
      id: string,
      disk: DiskPresence,
      name: string,
      options: { supported?: boolean } = {},
    ): HarnessEntry => ({ ...entry(id, disk, options), name });
    const inventory: HarnessInventory = {
      selection: { main: CLAUDE, aliases: [] },
      catalog: [
        CLAUDE_ENTRY,
        named("zed", "absent", "Zed"),
        named("cursor", "absent", "Cursor"),
        named("warp", "detected", "Warp"),
        named("codex", "detected", "Codex"),
        named("aider", "detected", "Aider", { supported: false }),
      ],
    };
    expect(availableHarnesses(inventory).map((item) => item.name)).toEqual([
      "Aider",
      "Codex",
      "Warp",
      "Cursor",
      "Zed",
    ]);
  });

  it("harnessSupportsLabel uses ResourceTypeTabs short names", () => {
    expect(harnessSupportsLabel(["skills", "mcp", "agents", "env_vars"])).toBe(
      "Skills, MCPs, Subagents, Env vars",
    );
    expect(harnessSupportsLabel([])).toBe("");
  });

  it("canRemoveHarness blocks the sole harness", () => {
    expect(canRemoveHarness({ main: CLAUDE, aliases: [] }, CLAUDE)).toEqual({
      ok: false,
      reason: "would-empty",
    });
    expect(canRemoveHarness({ main: CLAUDE, aliases: [CURSOR] }, CURSOR)).toEqual({ ok: true });
    expect(canRemoveHarness({ main: CLAUDE, aliases: [] }, CURSOR)).toEqual({
      ok: false,
      reason: "not-configured",
    });
  });

  it("removalCopy names the promoted harness when main is removed", () => {
    const inventory: HarnessInventory = {
      selection: { main: CLAUDE, aliases: [CURSOR] },
      catalog: [
        { ...CLAUDE_ENTRY, name: "Claude Code" },
        { ...entry("cursor", "absent"), name: "Cursor" },
      ],
    };
    expect(removalCopy(inventory, CLAUDE)).toEqual({
      title: "Remove Claude Code?",
      body: "Claude Code leaves your harness list. Files on disk stay. Cursor becomes the main harness.",
    });
    expect(removalCopy(inventory, CURSOR)).toEqual({
      title: "Remove Cursor?",
      body: "Cursor leaves your harness list. Files on disk stay.",
    });
  });

  it("summarizes resources and on-disk locations", () => {
    expect(harnessSummary(CLAUDE_ENTRY)).toBe("4 resources · 2 locations on disk");
    expect(diskPresenceLabel("shared-only")).toBe("shared paths only");
  });

  it("labels related, shared, and app-managed locations", () => {
    expect(locationRelationLabel(SKILLS)).toBeNull();
    expect(
      locationRelationLabel(
        location("~/.agents/skills/", ["skills"], true, [], { relation: "shared" }),
      ),
    ).toBe("shared");
    expect(
      locationRelationLabel(
        location("~/.cursor/skills-cursor/", ["skills"], true, [], {
          relation: "host-managed",
        }),
      ),
    ).toBe("app-managed");
    expect(
      locationRelationLabel(
        location("~/.claude/plugins/", ["plugins"], true, [], {
          relation: "related",
          relatedFrom: "Claude Code",
        }),
      ),
    ).toBe("also Claude Code");
  });
});

describe("filterHarnessLocations", () => {
  it("keeps every location, including empty ones, without a filter", () => {
    const result = filterHarnessLocations(CLAUDE_ENTRY, "", null);
    expect(result.locations.map((location) => location.path)).toEqual([
      "~/.claude/skills/",
      "~/.claude/rules/",
      "~/.claude/settings.json",
    ]);
    expect([...result.typeCounts.entries()]).toEqual([
      ["skill", 2],
      ["permission", 1],
      ["hook", 1],
    ]);
  });

  it("searches first, counts the searched set, then applies the type tab", () => {
    const result = filterHarnessLocations(CLAUDE_ENTRY, "alpha", "permission");
    expect([...result.typeCounts.entries()]).toEqual([
      ["skill", 1],
      ["permission", 1],
    ]);
    expect(result.locations).toEqual([
      {
        ...SETTINGS,
        resources: [row("permission", "alpha-allow", "~/.claude/settings.json")],
      },
    ]);
  });

  it("supports type:name search and drops empty locations while filtering", () => {
    const result = filterHarnessLocations(CLAUDE_ENTRY, "skill:beta", null);
    expect(result.locations).toEqual([
      { ...SKILLS, resources: [row("skill", "beta", "~/.claude/skills/beta/SKILL.md")] },
    ]);
  });

  it("matches names and type prefixes case-insensitively", () => {
    const byName = filterHarnessLocations(CLAUDE_ENTRY, "ALPHA", null);
    expect(
      byName.locations.flatMap((location) => location.resources.map((resource) => resource.name)),
    ).toEqual(["alpha", "alpha-allow"]);

    const byPrefix = filterHarnessLocations(CLAUDE_ENTRY, "SKILL:Beta", null);
    expect(byPrefix.locations).toEqual([
      { ...SKILLS, resources: [row("skill", "beta", "~/.claude/skills/beta/SKILL.md")] },
    ]);
  });

  it("filters only the typed query and does not fuzzy-match misspellings", () => {
    expect(filterHarnessLocations(CLAUDE_ENTRY, "alpah", null).locations).toEqual([]);
    expect(filterHarnessLocations(CLAUDE_ENTRY, "skil:beta", null).locations).toEqual([]);
    expect(
      filterHarnessLocations(CLAUDE_ENTRY, "alph", null).locations.flatMap((location) =>
        location.resources.map((resource) => resource.name),
      ),
    ).toEqual(["alpha", "alpha-allow"]);
  });

  it("filters by harness origin and marketplace independently of search", () => {
    const mixed = entry("cursor", "detected", {
      locations: [
        location("~/.cursor/skills/", ["skills"], true, [
          row("skill", "native", "~/.cursor/skills/native/SKILL.md"),
        ]),
        location("~/.claude/skills/", ["skills"], true, [
          row("skill", "claude", "~/.claude/skills/claude/SKILL.md", {
            origin_kind: "marketplace_link",
            origin_ref: "claude@official",
          }),
        ], { relation: "related", relatedFrom: "Claude Code" }),
        location("~/.claude/plugins/", ["plugins"], true, [
          row("plugin", "demo", "~/.claude/plugins/installed_plugins.json", {
            origin_kind: "marketplace_link",
            origin_ref: "demo@official",
          }),
        ], { relation: "related", relatedFrom: "Claude Code" }),
      ],
    });

    expect(harnessOriginFilterOptions(mixed).map((option) => option.id)).toEqual([
      "cursor",
      "claude-code",
    ]);
    expect(harnessMarketplaceFilterOptions(mixed)).toEqual([{ id: "official", label: "official" }]);
    expect(
      harnessResourceMarketplace({
        origin_kind: "marketplace_link",
        origin_ref: "demo@official",
      }),
    ).toBe("official");

    const byOrigin = filterHarnessLocations(mixed, "", null, {
      origins: new Set(["claude-code"]),
    });
    expect(
      byOrigin.locations.flatMap((location) => location.resources.map((resource) => resource.name)),
    ).toEqual(["claude", "demo"]);
    expect([...byOrigin.typeCounts.entries()]).toEqual([
      ["skill", 1],
      ["plugin", 1],
    ]);

    const byMarketplace = filterHarnessLocations(mixed, "", "skill", {
      marketplaces: new Set(["official"]),
    });
    expect(byMarketplace.locations).toEqual([
      {
        ...mixed.locations[1],
        resources: [
          row("skill", "claude", "~/.claude/skills/claude/SKILL.md", {
            origin_kind: "marketplace_link",
            origin_ref: "claude@official",
          }),
        ],
      },
    ]);
    expect([...byMarketplace.typeCounts.entries()]).toEqual([
      ["skill", 1],
      ["plugin", 1],
    ]);
  });

  it("finds Claude-directory plugins by marketplace identity", () => {
    const claude = entry("claude-code", "detected", {
      locations: [
        location("~/.claude/plugins/", ["plugins"], true, [
          row(
            "plugin",
            "superpowers",
            "~/.claude/plugins/installed_plugins.json",
            {
              namespace: "claude-plugins-official",
              origin_ref: "superpowers@claude-plugins-official",
            },
          ),
          row(
            "plugin",
            "superpowers",
            "~/.claude/plugins/installed_plugins.json",
            {
              namespace: "superpowers-dev",
              origin_ref: "superpowers@superpowers-dev",
            },
          ),
        ]),
      ],
    });
    const official = filterHarnessLocations(claude, "claude-plugins-official", null);
    expect(official.locations[0]?.resources.map((item) => item.origin_ref)).toEqual([
      "superpowers@claude-plugins-official",
    ]);
    expect(
      official.locations[0]?.resources.map((item) =>
        harnessResourceDisplayName(item, harnessDuplicatePluginNames(claude.locations)),
      ),
    ).toEqual(["superpowers@claude-plugins-official"]);
    const byName = filterHarnessLocations(claude, "superpowers", null);
    expect(byName.locations[0]?.resources).toHaveLength(2);
  });

  it("groups locations by resource type then harness section", () => {
    const cursor = entry("cursor", "detected", {
      locations: [
        location("~/.cursor/skills/", ["skills"], true, [
          row("skill", "native", "~/.cursor/skills/native/SKILL.md"),
        ]),
        location("~/.cursor/skills-cursor/", ["skills"], true, [
          row("skill", "builtin", "~/.cursor/skills-cursor/builtin/SKILL.md"),
        ], { relation: "host-managed" }),
        location("~/.agents/skills/", ["skills"], true, [
          row("skill", "hub", "~/.agents/skills/hub/SKILL.md"),
        ], { relation: "shared" }),
        location("~/.claude/skills/", ["skills"], true, [
          row("skill", "claude", "~/.claude/skills/claude/SKILL.md"),
        ], { relation: "related", relatedFrom: "Claude Code" }),
        location("~/.cursor/mcp.json", ["settings"], true, [
          row("mcp_server", "slack", "~/.cursor/mcp.json"),
        ]),
      ],
    });
    const groups = groupHarnessLocationsByType(cursor, cursor.locations);
    expect(groups.map((group) => group.type)).toEqual(["mcp_server", "skill"]);
    const skills = groups[1];
    expect(skills?.sections.map((section) => [section.owner.iconId, section.owner.name, section.path])).toEqual([
      ["cursor", "cursor", "~/.cursor/skills/"],
      ["cursor", "cursor", "~/.cursor/skills-cursor/"],
      ["agents", "Agents", "~/.agents/skills/"],
      ["claude-code", "Claude Code", "~/.claude/skills/"],
    ]);
    expect(groups[0]?.sections[0]?.resources.map((item) => item.name)).toEqual(["slack"]);
  });

  it("truncates badge titles and disambiguates colliding plugin names", () => {
    expect(truncateResourceBadgeName("short")).toBe("short");
    expect(truncateResourceBadgeName("abcdefghijklmnopqrstuvwxyz")).toBe(
      "abcdefghijklmnopqrst...",
    );
    expect(
      harnessResourceBadgeLabel(
        row("plugin", "superpowers", "~/.claude/plugins/installed_plugins.json", {
          origin_ref: "superpowers@claude-plugins-official",
        }),
      ),
    ).toBe("superpowers");
    const colliding = [
      row("plugin", "superpowers", "~/.claude/plugins/installed_plugins.json", {
        origin_ref: "superpowers@claude-plugins-official",
      }),
      row("plugin", "superpowers", "~/.claude/plugins/installed_plugins.json", {
        origin_ref: "superpowers@superpowers-dev",
      }),
    ];
    const dupes = harnessDuplicatePluginNames([{ resources: colliding }]);
    expect(harnessResourceBadgeLabel(colliding[0]!, dupes)).toBe(
      "superpowers@claude-plugins-official",
    );
  });

  it("omits empty harness sections and type groups with no resources", () => {
    const opencode = entry("opencode", "detected", {
      locations: [
        location("~/.config/opencode/skills/", ["skills"], true, [
          row("skill", "alpha", "~/.config/opencode/skills/alpha/SKILL.md"),
        ]),
        location("~/.config/opencode/", ["mcp", "commands"], true, []),
        location("~/.agents/skills/", ["skills"], true, [], { relation: "shared" }),
        location("~/.claude/skills/", ["skills"], true, [], {
          relation: "related",
          relatedFrom: "Claude Code",
        }),
      ],
    });
    const groups = groupHarnessLocationsByType(opencode, opencode.locations);
    expect(groups.map((group) => group.type)).toEqual(["skill"]);
    expect(
      groups[0]?.sections.map((section) => [
        section.owner.iconId,
        section.owner.name,
        section.path,
        section.resources.length,
      ]),
    ).toEqual([["opencode", "opencode", "~/.config/opencode/skills/", 1]]);
    expect(
      groupHarnessLocationsByType(CLAUDE_ENTRY, CLAUDE_ENTRY.locations).map((group) => group.type),
    ).toEqual(["skill", "hook", "permission"]);
    expect(
      groupHarnessLocationsByType(CLAUDE_ENTRY, [
        location("~/.claude/rules/", ["rules"], false, []),
      ]),
    ).toEqual([]);
    const mixedSurface = location(
      "~/.claude/",
      ["skills", "rules"],
      true,
      [row("skill", "only", "~/.claude/only/SKILL.md")],
    );
    expect(groupHarnessLocationsByType(CLAUDE_ENTRY, [mixedSurface]).map((group) => group.type)).toEqual(
      ["skill"],
    );
    const miss = filterHarnessLocations(opencode, "nope", null);
    expect(groupHarnessLocationsByType(opencode, miss.locations)).toEqual([]);
  });

  it("labels Agents for the shared ~/.agents hub", () => {
    expect(
      locationSectionOwner(
        location("~/.agents/skills/", ["skills"], true, [], { relation: "shared" }),
        CLAUDE_ENTRY,
      ),
    ).toEqual({ iconId: "agents", name: "Agents" });
  });

  it("builds a resource detail target from the library id and source", () => {
    expect(resourceDetailTargetFor(row("skill", "alpha", "~/.claude/skills/alpha/SKILL.md"))).toEqual({
      kind: "resource",
      selector: "skill-alpha",
      label: "alpha",
      pathHint: "~/.claude/skills/alpha/SKILL.md",
    });
    expect(resourceDetailTargetFor({ ...row("skill", "alpha", "~/x"), id: "" }).selector).toBe(
      "skill:alpha",
    );
  });
});

describe("parseHarnessInventory", () => {
  it("mints ids, maps wire fields, and drops aliases the catalog does not know", () => {
    expect(
      parseHarnessInventory({
        global: { main_harness: "claude-code", alias_harnesses: ["ghost", "cursor"] },
        root: "/home/tester",
        harnesses: [
          {
            id: "claude-code",
            name: "Claude Code",
            supported: true,
            supports: ["skills"],
            disk: "detected",
            locations: [
              {
                path: "~/.claude/skills/",
                surfaces: ["skills"],
                on_disk: true,
                resources: [
                  {
                    id: "r1",
                    type: "skill",
                    name: "alpha",
                    description: "A",
                    source: "~/.claude/skills/alpha/SKILL.md",
                    origin_kind: null,
                    origin_ref: null,
                  },
                ],
              },
            ],
          },
          { id: "cursor", name: "Cursor", supported: true, supports: [], disk: "absent", locations: [] },
        ],
      }),
    ).toEqual({
      selection: { main: CLAUDE, aliases: [CURSOR] },
      catalog: [
        {
          id: CLAUDE,
          name: "Claude Code",
          supported: true,
          supports: ["skills"],
          disk: "detected",
          locations: [
            {
              path: "~/.claude/skills/",
              surfaces: ["skills"],
              onDisk: true,
              relation: "native",
              relatedFrom: null,
              resources: [
                {
                  id: "r1",
                  type: "skill",
                  name: "alpha",
                  description: "A",
                  source: "~/.claude/skills/alpha/SKILL.md",
                  origin_kind: null,
                  namespace: null,
                  origin_ref: null,
                },
              ],
            },
          ],
        },
        { id: CURSOR, name: "Cursor", supported: true, supports: [], disk: "absent", locations: [] },
      ],
    });
  });

  it("returns a null selection when no main is saved", () => {
    expect(
      parseHarnessInventory({
        global: { main_harness: null, alias_harnesses: [] },
        root: "/home/tester",
        harnesses: [],
      }),
    ).toEqual({ selection: null, catalog: [] });
  });

  it("rejects a body with an unknown disk value", () => {
    expect(() =>
      parseHarnessInventory({
        global: { main_harness: null, alias_harnesses: [] },
        harnesses: [{ id: "x", name: "X", supported: false, supports: [], disk: "maybe" }],
      }),
    ).toThrow("Harness inventory is malformed: disk maybe");
  });
});

describe("harnessesViewReducer", () => {
  const inventory: HarnessInventory = {
    selection: { main: CLAUDE, aliases: [CURSOR] },
    catalog: [CLAUDE_ENTRY, entry("cursor", "absent")],
  };
  const target = resourceDetailTargetFor(SKILLS.resources[0] as HarnessResourceRow);

  it("starts on the main harness with the inventory pane", () => {
    expect(initialHarnessesViewState(inventory)).toEqual({
      selectedId: CLAUDE,
      pane: { mode: "inventory" },
      search: "",
      typeTab: null,
      originIds: [],
      marketplaceIds: [],
      editing: false,
    });
  });

  it("entering edit closes the detail pane", () => {
    const state = harnessesViewReducer(initialHarnessesViewState(inventory), {
      type: "open-detail",
      target,
    });
    expect(harnessesViewReducer(state, { type: "toggle-edit" })).toEqual({
      ...state,
      editing: true,
      pane: { mode: "inventory" },
    });
  });

  it("select switches harness and returns to inventory", () => {
    let state = initialHarnessesViewState(inventory);
    state = harnessesViewReducer(state, { type: "search", value: "alpha" });
    state = harnessesViewReducer(state, { type: "open-detail", target });
    expect(harnessesViewReducer(state, { type: "select", id: CURSOR })).toEqual({
      selectedId: CURSOR,
      pane: { mode: "inventory" },
      search: "alpha",
      typeTab: null,
      originIds: [],
      marketplaceIds: [],
      editing: false,
    });
  });

  it("falls back to main when the selected harness leaves the selection", () => {
    const state = { ...initialHarnessesViewState(inventory), selectedId: CURSOR };
    expect(
      harnessesViewReducer(state, {
        type: "inventory-loaded",
        inventory: { ...inventory, selection: { main: CLAUDE, aliases: [] } },
      }).selectedId,
    ).toBe(CLAUDE);
  });

  it("reset returns to the entrypoint", () => {
    let state = initialHarnessesViewState(inventory);
    state = harnessesViewReducer(state, { type: "select", id: CURSOR });
    state = harnessesViewReducer(state, { type: "type-tab", value: "skill" });
    state = harnessesViewReducer(state, { type: "origin-filter", value: ["claude-code"] });
    state = harnessesViewReducer(state, { type: "marketplace-filter", value: ["official"] });
    state = harnessesViewReducer(state, { type: "toggle-edit" });
    expect(harnessesViewReducer(state, { type: "reset", inventory })).toEqual(
      initialHarnessesViewState(inventory),
    );
  });
});
