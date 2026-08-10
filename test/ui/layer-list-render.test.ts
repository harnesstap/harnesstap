import { describe, expect, it } from "bun:test";
import type { CatalogLayer } from "../../src/services/catalog-types.js";
import type { Layer } from "../../src/types.js";
import {
  filterLocalBrowseRows,
  formatCatalogLayerListName,
  formatLocalLayerListName,
  listNavigableLayerListBrowseRows,
  renderGroupedLayerListBrowseViewport,
  resolveLayerListActiveSectionContext,
  toLocalBrowseRows,
  toRemoteBrowseRows,
} from "../../src/ui/layer-list-render.ts";
import { icons } from "../../src/ui/theme.ts";

function makeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: "layer-1",
    name: "team-stack",
    version: "1.0.0",
    org_slug: "",
    catalog_slug: "",
    origin: "authored",
    description: "Team baseline layer",
    tags: ["core"],
    dirty: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function makeCatalogLayer(overrides: Partial<CatalogLayer> = {}): CatalogLayer {
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

describe("layer list browse render", () => {
  it("orders navigable rows with local before remote", () => {
    const navigable = listNavigableLayerListBrowseRows(
      toLocalBrowseRows([makeLayer()]),
      toRemoteBrowseRows([makeCatalogLayer()]),
    );
    expect(navigable).toHaveLength(2);
    expect(navigable[0]?.section).toBe("local");
    expect(navigable[1]?.section).toBe("remote");
  });

  it("resolves section context across local and remote", () => {
    const navigable = listNavigableLayerListBrowseRows(
      toLocalBrowseRows([makeLayer()]),
      toRemoteBrowseRows([makeCatalogLayer()]),
    );
    const ctx = resolveLayerListActiveSectionContext(navigable, 1);
    expect(ctx.section).toBe("remote");
    expect(ctx.prevSection).toEqual({ section: "local", count: 1 });
  });

  it("renders only the active section in the viewport", () => {
    const navigable = listNavigableLayerListBrowseRows(
      toLocalBrowseRows([makeLayer({ name: "local-only" })]),
      toRemoteBrowseRows([makeCatalogLayer({ slug: "remote-only" })]),
    );
    const output = renderGroupedLayerListBrowseViewport({
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
      [makeLayer({ name: "alpha" }), makeLayer({ id: "layer-2", name: "beta" })],
      "beta",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.section).toBe("local");
    if (rows[0]?.section === "local") {
      expect(rows[0].layer.name).toBe("beta");
    }
  });

  it("shows overflow hint when local section exceeds short terminal viewport", () => {
    const navigable = listNavigableLayerListBrowseRows(
      toLocalBrowseRows(
        Array.from({ length: 15 }, (_, index) =>
          makeLayer({ id: `layer-${index}`, name: `layer-${index}` }),
        ),
      ),
      [],
    );
    const output = renderGroupedLayerListBrowseViewport({
      activeIndex: 10,
      navigable,
      terminalRows: 12,
      maxWidth: 80,
    });
    expect(output).toContain("more");
    expect(output).not.toContain("layer-0");
  });

  it("shows profile icon before profile layer names", () => {
    const profileLayer = makeLayer({ name: "my-profile", tags: ["profile"] });
    expect(formatLocalLayerListName(profileLayer, { static: true })).toContain(icons.profile);
    expect(formatLocalLayerListName(makeLayer(), { static: true })).toBe("team-stack");

    const navigable = listNavigableLayerListBrowseRows(
      toLocalBrowseRows([profileLayer, makeLayer({ id: "layer-2", name: "regular" })]),
      [],
    );
    const output = renderGroupedLayerListBrowseViewport({
      activeIndex: 0,
      navigable,
      terminalRows: 24,
      maxWidth: 80,
    });
    expect(output).toContain(icons.profile);
    expect(output).toContain("my-profile");
  });

  it("shows profile icon on remote catalog layers tagged profile", () => {
    const profileCatalog = makeCatalogLayer({
      slug: "work-profile",
      name: "Work",
      tags: ["profile"],
    });
    expect(formatCatalogLayerListName(profileCatalog)).toContain(icons.profile);

    const navigable = listNavigableLayerListBrowseRows(
      [],
      toRemoteBrowseRows([profileCatalog]),
    );
    const output = renderGroupedLayerListBrowseViewport({
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
    const local = makeLayer({
      name: "fullstack",
      version: "1.0.1",
      org_slug: "harnesstap-cloud",
      catalog_slug: "default",
    });
    const navigable = listNavigableLayerListBrowseRows(
      toLocalBrowseRows([local]),
      toRemoteBrowseRows([
        makeCatalogLayer({ slug: "fullstack", latestVersion: "1.2.3" }),
      ]),
    );
    const output = renderGroupedLayerListBrowseViewport({
      activeIndex: 1,
      navigable,
      terminalRows: 24,
      maxWidth: 120,
      scopeLabel: "harnesstap-cloud",
      localLayers: [local],
    });
    expect(output).toContain("harnesstap-cloud/default");
    expect(output).toContain("fullstack");
    expect(output).toContain("1.0.1");
    expect(output).not.toContain("ORG/CATALOG/LAYER");
  });

  it("limits a 13-row remote section on a typical terminal height", () => {
    const navigable = listNavigableLayerListBrowseRows(
      [],
      toRemoteBrowseRows(
        Array.from({ length: 13 }, (_, index) =>
          makeCatalogLayer({ slug: `remote-${index}`, name: `Remote ${index}` }),
        ),
      ),
    );
    const output = renderGroupedLayerListBrowseViewport({
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
