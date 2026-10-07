import { describe, expect, test } from "bun:test";
import {
  applyOriginOutdated,
  cloudHitIsInLibrary,
  isStandaloneResourceType,
  matchQuery,
  mergeSourcesHits,
  discoverListEmptyCopy,
  flattenDiscoverListItems,
  discoverListItemEstimateSize,
  DISCOVER_LIST_ROW_HEIGHT,
  filterDiscoverGroups,
  discoverListIsSearching,
  discoverMarketplaceRefreshCopy,
  discoverSourcesRefreshing,
  marketplaceIdsNeedingCatalogFetch,
  DISCOVER_MARKETPLACE_CACHE_MAX_AGE_MS,
  DISCOVER_MARKETPLACE_HIT_SCHEMA,
  nextMarketplaceHitsOnRefresh,
  presenceForCloud,
  presenceForMarketplace,
  sourcesHitFetchKey,
  sourcesHitRowDetail,
  sourcesHitUpdateBadge,
} from "../../apps/desktop/src/lib/sources-search.ts";
import type { PluginOriginCheckRow } from "../../apps/desktop/src/lib/api/plugin-origin-update.ts";

describe("isStandaloneResourceType", () => {
  test("excludes plugin refs and plugin_pins from standalone", () => {
    expect(isStandaloneResourceType("skill")).toBe(true);
    expect(isStandaloneResourceType("rule")).toBe(true);
    expect(isStandaloneResourceType("command")).toBe(true);
    expect(isStandaloneResourceType("plugin")).toBe(false);
    expect(isStandaloneResourceType("plugin_pin")).toBe(false);
  });
});

describe("matchQuery", () => {
  test("empty query matches all", () => {
    expect(matchQuery("anything", "")).toBe(true);
    expect(matchQuery("anything", "   ")).toBe(true);
  });

  test("matches case-insensitive includes", () => {
    expect(matchQuery("Focus plugin", "focus")).toBe(true);
    expect(matchQuery("Focus plugin", "PLUGIN")).toBe(true);
    expect(matchQuery("Focus plugin", "missing")).toBe(false);
  });
});

describe("presenceForCloud", () => {
  test("is in_library when a catalog head name matches the slug", () => {
    expect(
      presenceForCloud(
        { org: "acme", catalog: "default", name: "focus" },
        [{ name: "focus", origin: "catalog" }],
      ),
    ).toBe("in_library");
  });

  test("is remote_only when the head origin is not catalog or the slug differs", () => {
    expect(
      presenceForCloud(
        { org: "acme", catalog: "default", name: "focus" },
        [{ name: "focus", origin: "authored" }],
      ),
    ).toBe("remote_only");
    expect(
      presenceForCloud(
        { org: "acme", catalog: "default", name: "focus" },
        [{ name: "other", origin: "catalog" }],
      ),
    ).toBe("remote_only");
  });

  test("also requires org and catalog when those fields are present on a head", () => {
    expect(
      presenceForCloud(
        { org: "acme", catalog: "default", name: "focus" },
        [
          {
            name: "focus",
            origin: "catalog",
            org: "other",
            catalog: "default",
          },
        ],
      ),
    ).toBe("remote_only");
    expect(
      presenceForCloud(
        { org: "acme", catalog: "default", name: "focus" },
        [
          {
            name: "focus",
            origin: "catalog",
            org: "acme",
            catalog: "default",
          },
        ],
      ),
    ).toBe("in_library");
  });

  test("matches org_slug and catalog_slug when the head name equals the slug", () => {
    expect(
      presenceForCloud(
        { org: "acme", catalog: "default", name: "team" },
        [
          {
            name: "team",
            origin: "catalog",
            org_slug: "acme",
            catalog_slug: "default",
          },
        ],
      ),
    ).toBe("in_library");
  });

  test("does not treat a renamed catalog head as in_library from org and catalog alone", () => {
    expect(
      presenceForCloud(
        { org: "acme", catalog: "default", name: "team" },
        [
          {
            name: "team-from-cloud",
            origin: "catalog",
            org_slug: "acme",
            catalog_slug: "default",
          },
        ],
      ),
    ).toBe("remote_only");
  });
});

describe("cloudHitIsInLibrary", () => {
  const identity = { org: "acme", catalog: "default", name: "team" };
  const renamedHead = {
    name: "team-from-cloud",
    origin: "catalog",
    org_slug: "acme",
    catalog_slug: "default",
  };

  test("is in_library when a pulled key matches org/catalog/name", () => {
    expect(cloudHitIsInLibrary(identity, [renamedHead], ["acme/default/team"])).toBe(
      "in_library",
    );
  });

  test("falls back to head matching when the hit was not pulled this session", () => {
    expect(cloudHitIsInLibrary(identity, [renamedHead], [])).toBe("remote_only");
    expect(
      cloudHitIsInLibrary(
        identity,
        [
          {
            name: "team",
            origin: "catalog",
            org_slug: "acme",
            catalog_slug: "default",
          },
        ],
        [],
      ),
    ).toBe("in_library");
  });
});

describe("presenceForMarketplace", () => {
  test("is in_library for marketplace_link rows whose name matches the plugin", () => {
    expect(
      presenceForMarketplace("ship", "teads", [
        { name: "ship", type: "skill", origin_kind: "marketplace_link" },
      ]),
    ).toBe("in_library");
    expect(
      presenceForMarketplace("ship", "teads", [
        {
          name: "ship@teads",
          type: "skill",
          origin_kind: "marketplace_link",
        },
      ]),
    ).toBe("in_library");
  });

  test("is in_library for plugin or plugin_pin names that equal plugin or plugin@marketplace", () => {
    expect(
      presenceForMarketplace("ship", "teads", [
        { name: "ship@teads", type: "plugin", origin_kind: "manual" },
      ]),
    ).toBe("in_library");
    expect(
      presenceForMarketplace("ship", "teads", [
        { name: "ship", type: "plugin_pin" },
      ]),
    ).toBe("in_library");
  });

  test("does not treat a different plugin from the same marketplace as in_library", () => {
    expect(
      presenceForMarketplace("ship", "teads", [
        { name: "other@teads", type: "plugin", origin_kind: "manual" },
      ]),
    ).toBe("remote_only");
    expect(
      presenceForMarketplace("ship", "teads", [
        { name: "other@teads", type: "plugin_pin" },
      ]),
    ).toBe("remote_only");
    expect(
      presenceForMarketplace("ship", "teads", [
        {
          name: "other@teads",
          type: "skill",
          origin_kind: "marketplace_link",
        },
      ]),
    ).toBe("remote_only");
  });

  test("is remote_only when nothing matches", () => {
    expect(
      presenceForMarketplace("ship", "teads", [
        { name: "other", type: "skill", origin_kind: "manual" },
      ]),
    ).toBe("remote_only");
  });
});

describe("mergeSourcesHits", () => {
  test("omits local library inventory from discover hits", () => {
    const groups = mergeSourcesHits({
      sourceOrder: ["local"],
      local: {
        sourceId: "local",
        sourceLabel: "Local",
        heads: [
          {
            name: "devx",
            version: "1.0.0",
            description: "Authored plugin",
            origin: "authored",
          },
        ],
        resources: [
          { name: "ship", type: "skill", description: "Ship skill" },
          { name: "devx@teads", type: "plugin" },
          { name: "pinned", type: "plugin_pin" },
        ],
      },
    });

    expect(groups).toEqual([]);
  });

  test("marketplace and cloud inputs only produce plugin hits", () => {
    const groups = mergeSourcesHits({
      sourceOrder: ["mkt:teads", "org:acme"],
      marketplaces: [
        {
          sourceId: "mkt:teads",
          sourceLabel: "teads",
          marketplaceName: "teads",
          plugins: [{ name: "ship", version: "2.0.0", description: "Ship it" }],
        },
      ],
      cloud: [
        {
          sourceId: "org:acme",
          sourceLabel: "acme",
          plugins: [
            {
              selector: "acme/default/focus@2.0.0",
              name: "Focus",
              orgSlug: "acme",
              catalogSlug: "default",
              version: "2.0.0",
              description: "A focused profile",
            },
          ],
        },
      ],
    });

    expect(groups.map((group) => group.sourceId)).toEqual([
      "mkt:teads",
      "org:acme",
    ]);
    expect(groups.flatMap((group) => group.hits).map((hit) => hit.kind)).toEqual(
      ["plugin", "plugin"],
    );
    expect(groups[1]?.hits[0]).toMatchObject({
      name: "Focus",
      identity: { cloud: { org: "acme", catalog: "default", name: "focus" } },
    });
  });

  test("badges marketplace and cloud presence from library heads and resources", () => {
    const groups = mergeSourcesHits({
      sourceOrder: ["mkt:teads", "org:acme"],
      marketplaces: [
        {
          sourceId: "mkt:teads",
          sourceLabel: "teads",
          marketplaceName: "teads",
          plugins: [{ name: "ship" }, { name: "missing" }],
        },
      ],
      cloud: [
        {
          sourceId: "org:acme",
          sourceLabel: "acme",
          plugins: [
            {
              selector: "acme/default/focus@2.0.0",
              name: "Focus",
              orgSlug: "acme",
              catalogSlug: "default",
            },
            {
              selector: "acme/default/other@1.0.0",
              name: "Other",
              orgSlug: "acme",
              catalogSlug: "default",
            },
          ],
        },
      ],
      libraryHeads: [{ name: "focus", origin: "catalog" }],
      libraryResources: [
        { name: "ship", type: "skill", origin_kind: "marketplace_link" },
      ],
    });

    const marketplace = groups[0]?.hits ?? [];
    expect(marketplace.find((hit) => hit.name === "ship")?.presence).toBe(
      "in_library",
    );
    expect(marketplace.find((hit) => hit.name === "missing")?.presence).toBe(
      "remote_only",
    );
    const cloud = groups[1]?.hits ?? [];
    expect(cloud.find((hit) => hit.identity.cloud?.name === "focus")?.presence).toBe(
      "in_library",
    );
    expect(cloud.find((hit) => hit.identity.cloud?.name === "other")?.presence).toBe(
      "remote_only",
    );
  });

  test("empty query returns all; query filters name and description", () => {
    const input = {
      sourceOrder: ["org:acme"],
      cloud: [
        {
          sourceId: "org:acme",
          sourceLabel: "acme",
          plugins: [
            {
              selector: "acme/default/focus@2.0.0",
              name: "Focus",
              orgSlug: "acme",
              catalogSlug: "default",
              description: "A focused profile",
            },
            {
              selector: "acme/default/ship@1.0.0",
              name: "Ship",
              orgSlug: "acme",
              catalogSlug: "default",
              description: "Deploy skill",
            },
          ],
        },
      ],
    };

    const all = mergeSourcesHits({ ...input, query: "" });
    expect(all.flatMap((group) => group.hits).map((hit) => hit.name)).toEqual([
      "Focus",
      "Ship",
    ]);

    const byName = mergeSourcesHits({ ...input, query: "ship" });
    expect(byName.flatMap((group) => group.hits).map((hit) => hit.name)).toEqual([
      "Ship",
    ]);

    const byDescription = mergeSourcesHits({ ...input, query: "focused" });
    expect(
      byDescription.flatMap((group) => group.hits).map((hit) => hit.name),
    ).toEqual(["Focus"]);
  });

  test("marketplace search matches nested skill or command name and description", () => {
    const groups = mergeSourcesHits({
      query: "slack",
      sourceOrder: ["mkt:claude-plugins"],
      marketplaces: [
        {
          sourceId: "mkt:claude-plugins",
          sourceLabel: "claude-plugins",
          marketplaceName: "claude-plugins",
          plugins: [
            {
              name: "code-review-workflow",
              description: "End-to-end code review workflow.",
              contents: [
                {
                  type: "skill",
                  name: "request-slack-review",
                  description: "Request a Slack code review from the owning team.",
                },
              ],
            },
            {
              name: "design-doc",
              description: "Scaffold architecture docs.",
              contents: [
                {
                  type: "skill",
                  name: "confluence-slack-summary",
                  description: "Summarize a design doc and create a Slack draft.",
                },
              ],
            },
            { name: "unrelated", description: "Kubernetes helpers" },
          ],
        },
      ],
    });
    expect(groups.flatMap((group) => group.hits).map((hit) => hit.name)).toEqual([
      "code-review-workflow",
      "design-doc",
    ]);
  });

  test("marketplace search matches name or description such as slack", () => {
    const groups = mergeSourcesHits({
      query: "slack",
      sourceOrder: ["mkt:demo"],
      marketplaces: [
        {
          sourceId: "mkt:demo",
          sourceLabel: "demo",
          marketplaceName: "demo",
          plugins: [
            { name: "cursor-team", description: "Slack bot helpers" },
            { name: "other", description: "Unrelated" },
            { name: "slack-kit", description: "Team kit" },
          ],
        },
      ],
    });
    expect(groups.flatMap((group) => group.hits).map((hit) => hit.name)).toEqual([
      "cursor-team",
      "slack-kit",
    ]);
  });

  test("keeps a cloud plugin when the query matches tags but not name or description", () => {
    const groups = mergeSourcesHits({
      query: "ci",
      sourceOrder: ["org:acme"],
      cloud: [
        {
          sourceId: "org:acme",
          sourceLabel: "acme",
          plugins: [
            {
              selector: "acme/default/focus@2.0.0",
              name: "Focus",
              orgSlug: "acme",
              catalogSlug: "default",
              description: "A focused profile",
              tags: ["ci", "profile"],
            },
          ],
        },
      ],
    });

    expect(groups.flatMap((group) => group.hits).map((hit) => hit.name)).toEqual([
      "Focus",
    ]);
  });

  test("standalone local matches are not listed; marketplace content still matches", () => {
    expect(
      mergeSourcesHits({
        sourceOrder: ["local"],
        local: {
          sourceId: "local",
          sourceLabel: "Local",
          heads: [],
          resources: [
            {
              name: "ship",
              type: "skill",
              namespace: "acme",
              description: "Deploy",
            },
          ],
        },
        query: "skill",
      }).flatMap((group) => group.hits),
    ).toEqual([]);
  });

  test("dedupes cloud org and registered catalog hits with the same org/catalog/slug", () => {
    const groups = mergeSourcesHits({
      sourceOrder: ["org:acme", "cat:acme/default"],
      cloud: [
        {
          sourceId: "org:acme",
          sourceLabel: "acme",
          plugins: [
            {
              selector: "acme/default/focus@2.0.0",
              name: "Focus",
              orgSlug: "acme",
              catalogSlug: "default",
            },
          ],
        },
        {
          sourceId: "cat:acme/default",
          sourceLabel: "acme/default",
          plugins: [
            {
              selector: "acme/default/focus@1.0.0",
              name: "Focus",
              orgSlug: "acme",
              catalogSlug: "default",
            },
            {
              selector: "acme/internal/focus@3.0.0",
              name: "Focus Internal",
              orgSlug: "acme",
              catalogSlug: "internal",
            },
          ],
        },
      ],
    });

    expect(groups[0]?.hits.map((hit) => hit.identity.cloud)).toEqual([
      { org: "acme", catalog: "default", name: "focus" },
    ]);
    expect(groups[1]?.hits.map((hit) => hit.identity.cloud)).toEqual([
      { org: "acme", catalog: "internal", name: "focus" },
    ]);
  });

  test("preserves sourceOrder for remote sources and skips local", () => {
    const groups = mergeSourcesHits({
      sourceOrder: ["org:acme", "local", "mkt:teads"],
      local: {
        sourceId: "local",
        sourceLabel: "Local",
        heads: [{ name: "zeta" }, { name: "alpha" }],
        resources: [
          { name: "rule-a", type: "rule" },
          { name: "skill-a", type: "skill" },
        ],
      },
      marketplaces: [
        {
          sourceId: "mkt:teads",
          sourceLabel: "teads",
          marketplaceName: "teads",
          plugins: [{ name: "ship" }],
        },
      ],
      cloud: [
        {
          sourceId: "org:acme",
          sourceLabel: "acme",
          plugins: [
            {
              selector: "acme/default/focus@2.0.0",
              name: "Focus",
              orgSlug: "acme",
              catalogSlug: "default",
            },
          ],
        },
      ],
    });

    expect(groups.map((group) => group.sourceId)).toEqual([
      "org:acme",
      "mkt:teads",
    ]);
    expect(groups[1]?.hits.map((hit) => hit.kind)).toEqual(["plugin"]);
  });
});

describe("sourcesHitFetchKey", () => {
  test("is stable across rebuilt hit objects with the same identity", () => {
    const groups = mergeSourcesHits({
      sourceOrder: ["org:acme"],
      cloud: [
        {
          sourceId: "org:acme",
          sourceLabel: "acme",
          plugins: [
            {
              selector: "acme/default/focus@2.0.0",
              name: "Focus",
              orgSlug: "acme",
              catalogSlug: "default",
            },
          ],
        },
      ],
    });
    const rebuilt = mergeSourcesHits({
      sourceOrder: ["org:acme"],
      cloud: [
        {
          sourceId: "org:acme",
          sourceLabel: "acme",
          plugins: [
            {
              selector: "acme/default/focus@3.0.0",
              name: "Focus",
              orgSlug: "acme",
              catalogSlug: "default",
              description: "newer copy",
            },
          ],
        },
      ],
    });
    const first = groups[0]?.hits[0];
    const second = rebuilt[0]?.hits[0];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first === second).toBe(false);
    expect(sourcesHitFetchKey(first!)).toBe(sourcesHitFetchKey(second!));
    expect(sourcesHitFetchKey(first!)).toBe("cloud:acme/default/focus");
  });
});

function checkRow(
  origin_locator: string,
  status: PluginOriginCheckRow["status"],
): PluginOriginCheckRow {
  return {
    plugin_id: `id:${origin_locator}`,
    name: origin_locator,
    origin_locator,
    status,
    local_version: "1.0.0",
  };
}

describe("applyOriginOutdated", () => {
  test("marks in-library marketplace and catalog hits whose locator is outdated", () => {
    const groups = mergeSourcesHits({
      sourceOrder: ["mkt:official", "org:acme"],
      marketplaces: [
        {
          sourceId: "mkt:official",
          sourceLabel: "official",
          marketplaceName: "official",
          plugins: [{ name: "demo" }, { name: "other" }],
        },
      ],
      cloud: [
        {
          sourceId: "org:acme",
          sourceLabel: "acme",
          plugins: [
            {
              selector: "acme/default/focus",
              name: "Focus",
              orgSlug: "acme",
              catalogSlug: "default",
            },
          ],
        },
      ],
      libraryHeads: [{ name: "focus", origin: "catalog" }],
      libraryResources: [
        { name: "demo", type: "plugin", origin_kind: "marketplace_link" },
      ],
    });
    const hits = applyOriginOutdated(
      groups.flatMap((group) => group.hits),
      [
        checkRow("demo@official", "outdated"),
        checkRow("other@official", "current"),
        checkRow("acme/default/focus", "outdated"),
      ],
    );

    expect(hits.find((hit) => hit.name === "demo")?.originOutdated).toBe(true);
    expect(hits.find((hit) => hit.name === "other")?.originOutdated).toBeUndefined();
    expect(
      hits.find((hit) => hit.identity.cloud?.name === "focus")?.originOutdated,
    ).toBe(true);
    expect(sourcesHitUpdateBadge(hits.find((hit) => hit.name === "demo")!)).toBe(
      "Update available",
    );
    expect(sourcesHitUpdateBadge(hits.find((hit) => hit.name === "other")!)).toBe(
      null,
    );
  });

  test("does not mark remote-only hits even when the locator is outdated", () => {
    const groups = mergeSourcesHits({
      sourceOrder: ["mkt:official"],
      marketplaces: [
        {
          sourceId: "mkt:official",
          sourceLabel: "official",
          marketplaceName: "official",
          plugins: [{ name: "demo" }],
        },
      ],
    });
    const hits = applyOriginOutdated(groups.flatMap((group) => group.hits), [
      checkRow("demo@official", "outdated"),
    ]);
    expect(hits[0]?.presence).toBe("remote_only");
    expect(hits[0]?.originOutdated).toBeUndefined();
  });
});

describe("mergeSourcesHits presence", () => {
  test("keeps in-library marketplace hits in the unfiltered list", () => {
    const groups = mergeSourcesHits({
      sourceOrder: ["local", "mkt:teads"],
      local: {
        sourceId: "local",
        sourceLabel: "Local",
        heads: [{ name: "devx", version: "1.0.0" }],
        resources: [],
      },
      marketplaces: [
        {
          sourceId: "mkt:teads",
          sourceLabel: "teads",
          marketplaceName: "teads",
          plugins: [
            { name: "ship", version: "2.0.0" },
            { name: "already", version: "1.0.0" },
          ],
        },
      ],
      libraryResources: [
        {
          name: "already@teads",
          type: "plugin",
          origin_kind: "marketplace_link",
        },
      ],
    });
    expect(
      groups
        .find((group) => group.sourceId === "mkt:teads")
        ?.hits.map((hit) => [hit.name, hit.presence]),
    ).toEqual([
      ["ship", "remote_only"],
      ["already", "in_library"],
    ]);
    expect(
      groups.find((group) => group.sourceId === "local"),
    ).toBeUndefined();
  });

  test("keeps matching in-library plugins when searching", () => {
    const searched = mergeSourcesHits({
      query: "slack",
      sourceOrder: ["mkt:teads"],
      marketplaces: [
        {
          sourceId: "mkt:teads",
          sourceLabel: "teads-plugins",
          marketplaceName: "teads-plugins",
          plugins: [
            {
              name: "code-review-workflow",
              description: "End-to-end code review workflow.",
              contents: [
                {
                  type: "skill",
                  name: "request-slack-review",
                  description: "Request a Slack code review from the owning team.",
                },
              ],
            },
            { name: "unrelated", description: "Kubernetes helpers" },
          ],
        },
      ],
      libraryResources: [
        {
          name: "code-review-workflow@teads-plugins",
          type: "plugin",
          origin_kind: "marketplace_link",
        },
      ],
    });
    expect(
      searched.flatMap((group) => group.hits).map((hit) => [hit.name, hit.presence]),
    ).toEqual([["code-review-workflow", "in_library"]]);
  });
});

describe("filterDiscoverGroups", () => {
  const groups = mergeSourcesHits({
    sourceOrder: ["mkt:teads"],
    marketplaces: [
      {
        sourceId: "mkt:teads",
        sourceLabel: "teads",
        marketplaceName: "teads",
        plugins: [{ name: "ship" }, { name: "missing" }],
      },
    ],
    libraryResources: [{ name: "ship", type: "plugin" }],
  });

  test("keeps in-library hits when the not-in-library filter is off", () => {
    expect(
      filterDiscoverGroups(groups, false).flatMap((group) =>
        group.hits.map((hit) => [hit.name, hit.presence]),
      ),
    ).toEqual([
      ["ship", "in_library"],
      ["missing", "remote_only"],
    ]);
  });

  test("drops in-library hits when the not-in-library filter is on", () => {
    expect(
      filterDiscoverGroups(groups, true).flatMap((group) =>
        group.hits.map((hit) => [hit.name, hit.presence]),
      ),
    ).toEqual([["missing", "remote_only"]]);
  });
});

describe("discoverListEmptyCopy", () => {
  test("prompts to search when the unfiltered list is empty", () => {
    expect(discoverListEmptyCopy({ query: "" })).toEqual({
      message: "Search to add",
      hint: "Type a name, description, or skill.",
      action: null,
    });
    expect(discoverListEmptyCopy({ query: "ship" })).toEqual({
      message: 'No results for "ship"',
      hint: "Clear search to see every source again.",
      action: "clear-search",
    });
  });

  test("offers Clear filters when Not in my library hides every hit", () => {
    expect(
      discoverListEmptyCopy({ query: "", notInLibrary: true, unfilteredCount: 3 }),
    ).toEqual({
      message: "No results",
      hint: "Clear filters to see every source again.",
      action: "clear-filters",
    });
    expect(
      discoverListEmptyCopy({ query: "", notInLibrary: true, unfilteredCount: 0 }),
    ).toEqual({
      message: "Search to add",
      hint: "Type a name, description, or skill.",
      action: null,
    });
    expect(
      discoverListEmptyCopy({ query: "ship", notInLibrary: true }),
    ).toEqual({
      message: 'No results for "ship"',
      hint: "Clear search to see every source again.",
      action: "clear-search",
    });
  });
});

describe("discoverListIsSearching", () => {
  test("is true only when checked sources have never fetched and the list is empty", () => {
    expect(
      discoverListIsSearching({
        checkedIds: ["local"],
        fetchedIds: new Set(),
        visibleCount: 0,
      }),
    ).toBe(true);
    expect(
      discoverListIsSearching({
        checkedIds: ["local"],
        fetchedIds: new Set(["local"]),
        visibleCount: 0,
      }),
    ).toBe(false);
    expect(
      discoverListIsSearching({
        checkedIds: ["local"],
        fetchedIds: new Set(),
        visibleCount: 3,
      }),
    ).toBe(false);
  });

  test("is true while a refresh search or load is in flight even if sources already fetched", () => {
    expect(
      discoverListIsSearching({
        checkedIds: ["mkt:acme", "mkt:beta"],
        fetchedIds: new Set(["mkt:acme", "mkt:beta"]),
        inflightIds: new Set(["mkt:beta"]),
        visibleCount: 0,
      }),
    ).toBe(true);
    expect(
      discoverListIsSearching({
        checkedIds: ["local", "org:cloud"],
        fetchedIds: new Set(["local"]),
        inflightIds: new Set(["org:cloud"]),
        visibleCount: 0,
      }),
    ).toBe(true);
    expect(
      discoverListIsSearching({
        checkedIds: ["mkt:acme"],
        fetchedIds: new Set(["mkt:acme"]),
        inflightIds: new Set(["mkt:acme"]),
        visibleCount: 4,
      }),
    ).toBe(false);
  });

  test("is true while Discover search is pending on an empty list without catalog inflight", () => {
    expect(
      discoverListIsSearching({
        checkedIds: ["mkt:acme"],
        fetchedIds: new Set(["mkt:acme"]),
        visibleCount: 0,
        searchPending: true,
      }),
    ).toBe(true);
    expect(
      discoverListIsSearching({
        checkedIds: ["mkt:acme"],
        fetchedIds: new Set(["mkt:acme"]),
        visibleCount: 4,
        searchPending: true,
      }),
    ).toBe(false);
  });
});

describe("marketplaceIdsNeedingCatalogFetch", () => {
  const hits = {
    "mkt:acme": { plugins: [{ name: "focus" }], error: null },
    "mkt:empty": { plugins: [], error: null },
  };

  test("reuses current-schema cached marketplace catalogs fetched within 60 minutes", () => {
    const now = new Date("2026-10-03T12:00:00.000Z");
    expect(
      marketplaceIdsNeedingCatalogFetch({
        marketplaceIds: ["mkt:acme", "mkt:beta", "mkt:empty", "mkt:stale"],
        hits: {
          "mkt:acme": {
            plugins: [{ name: "focus" }],
            error: null,
            schema: DISCOVER_MARKETPLACE_HIT_SCHEMA,
            fetchedAt: now.toISOString(),
          },
          "mkt:empty": { plugins: [], error: null },
          "mkt:stale": { plugins: [{ name: "old" }], error: null },
        },
        bypassCache: false,
        now,
      }),
    ).toEqual(["mkt:beta", "mkt:empty", "mkt:stale"]);
  });

  test("refetches marketplace catalogs older than 60 minutes", () => {
    const now = new Date("2026-10-03T12:00:00.000Z");
    const staleAt = new Date(
      now.getTime() - DISCOVER_MARKETPLACE_CACHE_MAX_AGE_MS - 1,
    ).toISOString();
    expect(
      marketplaceIdsNeedingCatalogFetch({
        marketplaceIds: ["mkt:acme"],
        hits: {
          "mkt:acme": {
            plugins: [{ name: "focus" }],
            error: null,
            schema: DISCOVER_MARKETPLACE_HIT_SCHEMA,
            fetchedAt: staleAt,
          },
        },
        bypassCache: false,
        now,
      }),
    ).toEqual(["mkt:acme"]);
  });

  test("uses a configured marketplace refresh max age", () => {
    const now = new Date("2026-10-03T12:00:00.000Z");
    const fifteenMinutesMs = 15 * 60 * 1000;
    expect(
      marketplaceIdsNeedingCatalogFetch({
        marketplaceIds: ["mkt:fresh", "mkt:stale"],
        hits: {
          "mkt:fresh": {
            plugins: [{ name: "focus" }],
            schema: DISCOVER_MARKETPLACE_HIT_SCHEMA,
            fetchedAt: new Date(now.getTime() - fifteenMinutesMs + 1).toISOString(),
          },
          "mkt:stale": {
            plugins: [{ name: "old" }],
            schema: DISCOVER_MARKETPLACE_HIT_SCHEMA,
            fetchedAt: new Date(now.getTime() - fifteenMinutesMs - 1).toISOString(),
          },
        },
        bypassCache: false,
        now,
        maxAgeMs: fifteenMinutesMs,
      }),
    ).toEqual(["mkt:stale"]);
  });

  test("refetches every marketplace when bypassing cache", () => {
    expect(
      marketplaceIdsNeedingCatalogFetch({
        marketplaceIds: ["mkt:acme", "mkt:beta"],
        hits,
        bypassCache: true,
      }),
    ).toEqual(["mkt:acme", "mkt:beta"]);
  });
});

describe("discoverSourcesRefreshing", () => {
  test("is true when an already-fetched source is in flight again", () => {
    expect(
      discoverSourcesRefreshing({
        fetchedIds: new Set(["local"]),
        inflightIds: new Set(["local"]),
      }),
    ).toBe(true);
    expect(
      discoverSourcesRefreshing({
        fetchedIds: new Set(),
        inflightIds: new Set(["local"]),
      }),
    ).toBe(false);
  });
});

describe("discoverMarketplaceRefreshCopy", () => {
  test("returns null when no marketplaces are in flight", () => {
    expect(
      discoverMarketplaceRefreshCopy({
        marketplaceIds: ["mkt:acme", "mkt:beta"],
        inflightIds: new Set(),
      }),
    ).toBeNull();
    expect(
      discoverMarketplaceRefreshCopy({
        marketplaceIds: [],
        inflightIds: new Set(["mkt:acme"]),
      }),
    ).toBeNull();
  });

  test("counts completed marketplaces of the current wave", () => {
    expect(
      discoverMarketplaceRefreshCopy({
        marketplaceIds: [
          "mkt:one",
          "mkt:two",
          "mkt:three",
          "mkt:four",
        ],
        inflightIds: new Set(["mkt:three", "mkt:four"]),
      }),
    ).toBe("Refreshing 2/4 marketplaces");
    expect(
      discoverMarketplaceRefreshCopy({
        marketplaceIds: ["mkt:acme"],
        inflightIds: new Set(["mkt:acme"]),
      }),
    ).toBe("Refreshing 0/1 marketplaces");
  });
});

describe("nextMarketplaceHitsOnRefresh", () => {
  test("keeps cached hits when marketplace inventory is not ready yet", () => {
    const current = {
      "mkt:acme": { plugins: [{ name: "focus" }], error: null },
    };
    expect(
      nextMarketplaceHitsOnRefresh({
        current,
        marketplaceIds: [],
        inventoryReady: false,
      }),
    ).toEqual(current);
  });

  test("keeps last-good plugins for still-checked marketplaces", () => {
    expect(
      nextMarketplaceHitsOnRefresh({
        current: {
          "mkt:acme": { plugins: [{ name: "focus" }], error: null },
          "mkt:gone": { plugins: [{ name: "old" }], error: null },
        },
        marketplaceIds: ["mkt:acme", "mkt:beta"],
        inventoryReady: true,
      }),
    ).toEqual({
      "mkt:acme": { plugins: [{ name: "focus" }], error: null },
      "mkt:beta": { plugins: [], error: null },
    });
  });
});

describe("sourcesHitRowDetail", () => {
  test("keeps version and description and omits the resource type", () => {
    expect(
      sourcesHitRowDetail({
        version: "1.2.0",
        description: "Ship it",
      }),
    ).toBe("1.2.0 · Ship it");
    expect(sourcesHitRowDetail({ description: "Ship it" })).toBe("Ship it");
    expect(sourcesHitRowDetail({ version: "  " })).toBeNull();
  });
});

describe("flattenDiscoverListItems", () => {
  const hit = {
    id: "mkt:acme/focus",
    kind: "plugin" as const,
    name: "focus",
    typeLabel: "plugin",
    sourceId: "mkt:acme",
    sourceLabel: "acme",
    presence: "remote_only" as const,
    identity: { marketplace: { marketplace: "acme", plugin: "focus" } },
  };

  test("skips empty groups without errors and sizes rows for the virtualizer", () => {
    const items = flattenDiscoverListItems({
      groups: [
        { sourceId: "local", sourceLabel: "Local", hits: [] },
        { sourceId: "mkt:acme", sourceLabel: "acme", hits: [hit] },
        {
          sourceId: "org:cloud",
          sourceLabel: "cloud",
          hits: [],
        },
      ],
      groupErrors: {
        "org:cloud": { message: "Sign in required", authRequired: true },
      },
    });
    expect(items.map((item) => item.kind)).toEqual([
      "heading",
      "hit",
      "heading",
      "error",
    ]);
    expect(discoverListItemEstimateSize(items[1]!)).toBe(DISCOVER_LIST_ROW_HEIGHT);
  });
});
