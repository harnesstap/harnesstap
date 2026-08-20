import { describe, expect, test } from "bun:test";
import {
  isStandaloneResourceType,
  matchQuery,
  mergeSourcesHits,
  presenceForCloud,
  presenceForMarketplace,
} from "../../apps/desktop/src/lib/sources-search.ts";

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
});

describe("presenceForMarketplace", () => {
  test("is in_library for marketplace_link rows whose name matches the plugin", () => {
    expect(
      presenceForMarketplace("ship", "teads", [
        { name: "ship", type: "skill", origin_kind: "marketplace_link" },
      ]),
    ).toBe("in_library");
  });

  test("is in_library for plugin or plugin_pin names that include @marketplace", () => {
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

  test("is remote_only when nothing matches", () => {
    expect(
      presenceForMarketplace("ship", "teads", [
        { name: "other", type: "skill", origin_kind: "manual" },
      ]),
    ).toBe("remote_only");
  });
});

describe("mergeSourcesHits", () => {
  test("local plugins and standalone material resources appear; plugin refs and pins do not as standalone", () => {
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

    expect(groups).toHaveLength(1);
    expect(groups[0]?.hits.map((hit) => ({ kind: hit.kind, name: hit.name }))).toEqual([
      { kind: "plugin", name: "devx" },
      { kind: "standalone", name: "ship" },
    ]);
    expect(groups[0]?.hits.every((hit) => hit.presence === "in_library")).toBe(
      true,
    );
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
      sourceOrder: ["local", "org:acme"],
      local: {
        sourceId: "local",
        sourceLabel: "Local",
        heads: [{ name: "devx", description: "Engineering plugin" }],
        resources: [
          { name: "ship", type: "skill", description: "Deploy skill" },
          { name: "dbt", type: "skill", description: "Models" },
        ],
      },
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
          ],
        },
      ],
    };

    const all = mergeSourcesHits({ ...input, query: "" });
    expect(all.flatMap((group) => group.hits).map((hit) => hit.name)).toEqual([
      "devx",
      "ship",
      "dbt",
      "Focus",
    ]);

    const byName = mergeSourcesHits({ ...input, query: "ship" });
    expect(byName.flatMap((group) => group.hits).map((hit) => hit.name)).toEqual([
      "ship",
    ]);

    const byDescription = mergeSourcesHits({ ...input, query: "focused" });
    expect(
      byDescription.flatMap((group) => group.hits).map((hit) => hit.name),
    ).toEqual(["Focus"]);
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

  test("preserves sourceOrder and puts plugins before standalone inside a group", () => {
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
      "local",
      "mkt:teads",
    ]);
    expect(groups[1]?.hits.map((hit) => hit.kind)).toEqual([
      "plugin",
      "plugin",
      "standalone",
      "standalone",
    ]);
  });
});
