import { describe, expect, it } from "bun:test";
import type { CatalogPlugin } from "../../src/services/catalog-types.js";
import type { Plugin } from "../../src/types.js";
import {
  filterLocalBrowseRows,
  formatCatalogPluginListName,
  formatLocalPluginListName,
  listNavigablePluginListBrowseRows,
  renderGroupedPluginListBrowseViewport,
  resolvePluginListActiveSectionContext,
  toLocalBrowseRows,
  toRemoteBrowseRows,
} from "../../src/ui/plugin-list-render.ts";
import { icons } from "../../src/ui/theme.ts";

function makePlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    id: "plugin-1",
    name: "team-stack",
    version: "1.0.0",
    org_slug: "",
    catalog_slug: "",
    origin: "authored",
    description: "Team baseline plugin",
    tags: ["core"],
    dirty: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function makeCatalogPlugin(overrides: Partial<CatalogPlugin> = {}): CatalogPlugin {
  return {
    orgSlug: "harnesstap-cloud",
    catalogSlug: "default",
    slug: "fullstack",
    name: "Fullstack",
    summary: "Fullstack baseline",
    latestVersion: "1.0.0",
    updatedAt: "2026-01-03T00:00:00.000Z",
    tags: ["baseline"],
    visibility: "public",
    ...overrides,
  };
}

describe("plugin list browse render", () => {
  it("orders navigable rows with local before remote", () => {
    const navigable = listNavigablePluginListBrowseRows(
      toLocalBrowseRows([makePlugin()]),
      toRemoteBrowseRows([makeCatalogPlugin()]),
    );
    expect(navigable).toHaveLength(2);
    expect(navigable[0]?.section).toBe("local");
    expect(navigable[1]?.section).toBe("remote");
  });

  it("resolves section context across local and remote", () => {
    const navigable = listNavigablePluginListBrowseRows(
      toLocalBrowseRows([makePlugin()]),
      toRemoteBrowseRows([makeCatalogPlugin()]),
    );
    const ctx = resolvePluginListActiveSectionContext(navigable, 1);
    expect(ctx.section).toBe("remote");
    expect(ctx.prevSection).toEqual({ section: "local", count: 1 });
  });

  it("renders only the active section in the viewport", () => {
    const navigable = listNavigablePluginListBrowseRows(
      toLocalBrowseRows([makePlugin({ name: "local-only" })]),
      toRemoteBrowseRows([makeCatalogPlugin({ slug: "remote-only" })]),
    );
    const output = renderGroupedPluginListBrowseViewport({
      activeIndex: 0,
      navigable,
      terminalRows: 24,
      maxWidth: 80,
      scopeLabel: "harnesstap-cloud",
    });
    expect(output).toContain("local-only");
    expect(output).not.toContain("remote-only");
  });

  it("filters local browse rows by search", () => {
    const rows = filterLocalBrowseRows(
      [makePlugin({ name: "alpha" }), makePlugin({ id: "plugin-2", name: "beta" })],
      "beta",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.section).toBe("local");
    if (rows[0]?.section === "local") {
      expect(rows[0].plugin.name).toBe("beta");
    }
  });

  it("shows overflow hint when local section exceeds short terminal viewport", () => {
    const navigable = listNavigablePluginListBrowseRows(
      toLocalBrowseRows(
        Array.from({ length: 15 }, (_, index) =>
          makePlugin({ id: `plugin-${index}`, name: `plugin-${index}` }),
        ),
      ),
      [],
    );
    const output = renderGroupedPluginListBrowseViewport({
      activeIndex: 10,
      navigable,
      terminalRows: 12,
      maxWidth: 80,
    });
    expect(output).toContain("more");
    expect(output).not.toContain("plugin-0");
  });

  it("shows profile icon before profile plugin names", () => {
    const profilePlugin = makePlugin({ name: "my-profile", tags: ["profile"] });
    expect(formatLocalPluginListName(profilePlugin, { static: true })).toContain(icons.profile);
    expect(formatLocalPluginListName(makePlugin(), { static: true })).toBe("team-stack");

    const navigable = listNavigablePluginListBrowseRows(
      toLocalBrowseRows([profilePlugin, makePlugin({ id: "plugin-2", name: "regular" })]),
      [],
    );
    const output = renderGroupedPluginListBrowseViewport({
      activeIndex: 0,
      navigable,
      terminalRows: 24,
      maxWidth: 80,
    });
    expect(output).toContain(icons.profile);
    expect(output).toContain("my-profile");
  });

  it("shows profile icon on remote catalog plugins tagged profile", () => {
    const profileCatalog = makeCatalogPlugin({
      slug: "work-profile",
      name: "Work",
      tags: ["profile"],
    });
    expect(formatCatalogPluginListName(profileCatalog)).toContain(icons.profile);

    const navigable = listNavigablePluginListBrowseRows(
      [],
      toRemoteBrowseRows([profileCatalog]),
    );
    const output = renderGroupedPluginListBrowseViewport({
      activeIndex: 0,
      navigable,
      terminalRows: 24,
      maxWidth: 100,
      scopeLabel: "harnesstap-cloud",
    });
    expect(output).toContain(icons.profile);
    expect(output).toContain("work-profile");
    expect(output).toContain("CATALOG");
    expect(output).toContain("harnesstap-cloud/default");
  });

  it("renders remote catalog table with catalog path, slug, and version drift", () => {
    const local = makePlugin({
      name: "fullstack",
      version: "1.0.1",
      org_slug: "harnesstap-cloud",
      catalog_slug: "default",
    });
    const navigable = listNavigablePluginListBrowseRows(
      toLocalBrowseRows([local]),
      toRemoteBrowseRows([
        makeCatalogPlugin({ slug: "fullstack", latestVersion: "1.2.3" }),
      ]),
    );
    const output = renderGroupedPluginListBrowseViewport({
      activeIndex: 1,
      navigable,
      terminalRows: 24,
      maxWidth: 120,
      scopeLabel: "harnesstap-cloud",
      localPlugins: [local],
    });
    expect(output).toContain("harnesstap-cloud/default");
    expect(output).toContain("fullstack");
    expect(output).toContain("1.0.1");
    expect(output).not.toContain("ORG/CATALOG/PLUGIN");
  });

  it("limits a 13-row remote section on a typical terminal height", () => {
    const navigable = listNavigablePluginListBrowseRows(
      [],
      toRemoteBrowseRows(
        Array.from({ length: 13 }, (_, index) =>
          makeCatalogPlugin({ slug: `remote-${index}`, name: `Remote ${index}` }),
        ),
      ),
    );
    const output = renderGroupedPluginListBrowseViewport({
      activeIndex: 0,
      navigable,
      terminalRows: 36,
      maxWidth: 100,
      scopeLabel: "harnesstap-cloud",
    });
    const visibleRemoteRows = output.match(/remote-\d+/g) ?? [];
    expect(visibleRemoteRows.length).toBeLessThan(13);
    expect(output).toContain("more");
  });
});
