import { describe, expect, it } from "bun:test";
import { filterLocalPlugins } from "../../src/services/plugin-list.js";
import type { Plugin } from "../../src/types.js";

function makePlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    id: "plugin-1",
    name: "team-stack",
    version: "1.0.0",
    org_slug: "",
    catalog_slug: "",
    description: "Team baseline plugin",
    tags: ["core", "shared"],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("filterLocalPlugins", () => {
  const plugins = [
    makePlugin(),
    makePlugin({
      id: "plugin-2",
      name: "demo-api",
      description: "API helpers",
      tags: ["api"],
    }),
  ];

  it("returns all plugins when search is empty", () => {
    expect(filterLocalPlugins(plugins)).toHaveLength(2);
    expect(filterLocalPlugins(plugins, "   ")).toHaveLength(2);
  });

  it("filters by plugin name", () => {
    expect(filterLocalPlugins(plugins, "demo")).toEqual([plugins[1]]);
  });

  it("filters by description", () => {
    expect(filterLocalPlugins(plugins, "baseline")).toEqual([plugins[0]]);
  });

  it("filters by tags", () => {
    expect(filterLocalPlugins(plugins, "api")).toEqual([plugins[1]]);
    expect(filterLocalPlugins(plugins, "shared")).toEqual([plugins[0]]);
  });

  it("is case-insensitive", () => {
    expect(filterLocalPlugins(plugins, "TEAM")).toEqual([plugins[0]]);
  });
});
