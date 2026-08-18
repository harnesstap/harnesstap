import { describe, expect, it } from "bun:test";
import type { PluginContainedResource } from "../../apps/desktop/src/lib/types.ts";
import {
  PLUGIN_REF_EMPTY_RESOURCES_COPY,
  groupContainedResources,
  isPluginTypeResource,
  pluginRefShowsMarketplaceUrl,
} from "../../apps/desktop/src/lib/plugin-ref-detail.ts";

describe("plugin-ref detail helpers", () => {
  it("treats storage type plugin as a plugin-ref row", () => {
    expect(isPluginTypeResource("plugin")).toBe(true);
    expect(isPluginTypeResource("skill")).toBe(false);
  });

  it("groups contained files by library type order and sorts paths", () => {
    const rows: PluginContainedResource[] = [
      {
        type: "hook",
        name: "stop",
        path: "/tmp/hooks/stop.json",
        relative_path: "hooks/stop.json",
      },
      {
        type: "skill",
        name: "b",
        path: "/tmp/skills/b/SKILL.md",
        relative_path: "skills/b/SKILL.md",
      },
      {
        type: "skill",
        name: "a",
        path: "/tmp/skills/a/SKILL.md",
        relative_path: "skills/a/SKILL.md",
      },
    ];
    expect(groupContainedResources(rows)).toEqual([
      {
        type: "skill",
        resources: [
          {
            type: "skill",
            name: "a",
            path: "/tmp/skills/a/SKILL.md",
            relative_path: "skills/a/SKILL.md",
          },
          {
            type: "skill",
            name: "b",
            path: "/tmp/skills/b/SKILL.md",
            relative_path: "skills/b/SKILL.md",
          },
        ],
      },
      {
        type: "hook",
        resources: [
          {
            type: "hook",
            name: "stop",
            path: "/tmp/hooks/stop.json",
            relative_path: "hooks/stop.json",
          },
        ],
      },
    ]);
  });

  it("exports the empty-state copy from the spec", () => {
    expect(PLUGIN_REF_EMPTY_RESOURCES_COPY).toBe(
      "Sync to load resources from the install tree.",
    );
  });

  it("shows marketplace URL only for marketplace plugin refs with a URL", () => {
    expect(
      pluginRefShowsMarketplaceUrl({
        type: "plugin",
        origin_kind: "marketplace_link",
        marketplace_url: "https://github.com/acme/team-plugins",
      }),
    ).toBe(true);
    expect(
      pluginRefShowsMarketplaceUrl({
        type: "plugin",
        origin_kind: "manual",
        marketplace_url: "https://github.com/acme/team-plugins",
      }),
    ).toBe(false);
    expect(
      pluginRefShowsMarketplaceUrl({
        type: "plugin",
        origin_kind: "marketplace_link",
        marketplace_url: null,
      }),
    ).toBe(false);
    expect(
      pluginRefShowsMarketplaceUrl({
        type: "skill",
        origin_kind: "marketplace_link",
        marketplace_url: "https://github.com/acme/team-plugins",
      }),
    ).toBe(false);
  });
});
