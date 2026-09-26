import { describe, expect, it } from "bun:test";
import type { PluginContainedResource } from "../../apps/desktop/src/lib/types.ts";
import {
  CONTAINED_FILES_PAGE_SIZE,
  PLUGIN_REF_EMPTY_RESOURCES_COPY,
  containedFilesCanRevealMore,
  groupContainedResources,
  isPluginTypeResource,
  pluginRefShowsMarketplaceUrl,
  resourceDetailUsesFileTree,
  sliceContainedFiles,
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
    expect(PLUGIN_REF_EMPTY_RESOURCES_COPY).toBe("Nothing loaded yet.");
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

  it("uses a file tree for plugins and SKILL.md packages", () => {
    expect(
      resourceDetailUsesFileTree({
        type: "plugin",
        source: "composition:plugin",
      }),
    ).toBe(true);
    expect(
      resourceDetailUsesFileTree({
        type: "skill",
        filesystem_path: "/tmp/skills/last30days/SKILL.md",
        source: "/tmp/skills/last30days/SKILL.md",
      }),
    ).toBe(true);
    expect(
      resourceDetailUsesFileTree({
        type: "skill",
        source: "manual",
      }),
    ).toBe(false);
  });

  it("caps the visible file list at 20 and keeps Show more when the server has more", () => {
    expect(CONTAINED_FILES_PAGE_SIZE).toBe(20);
    const rows: PluginContainedResource[] = Array.from({ length: 25 }, (_, index) => ({
      type: "skill",
      name: `s${index}`,
      path: `/tmp/s${index}`,
      relative_path: `skills/s${String(index).padStart(2, "0")}/SKILL.md`,
    }));
    expect(sliceContainedFiles(rows, CONTAINED_FILES_PAGE_SIZE)).toHaveLength(20);
    expect(containedFilesCanRevealMore(20, 20, true)).toBe(true);
    expect(containedFilesCanRevealMore(20, 25, false)).toBe(true);
    expect(containedFilesCanRevealMore(25, 25, false)).toBe(false);
  });
});
