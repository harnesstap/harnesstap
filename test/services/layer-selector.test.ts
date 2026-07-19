import { describe, expect, it } from "bun:test";
import {
  DEFAULT_CATALOG_SLUG,
  formatCanonicalPublishedSelectorWithVersion,
  formatPublishedSelector,
  formatPublishedSelectorWithVersion,
  parseLayerSelector,
  resolveRemoteLayerSelector,
  resolvedRemoteLayerFromCatalog,
} from "../../src/services/layer-selector.js";

describe("parseLayerSelector", () => {
  it("parses local name-only selectors", () => {
    expect(parseLayerSelector("frontend")).toEqual({
      scope: "local",
      name: "frontend",
    });
  });

  it("parses local name@version selectors", () => {
    expect(parseLayerSelector("frontend@2.0.0")).toEqual({
      scope: "local",
      name: "frontend",
      version: "2.0.0",
    });
  });

  it("parses three-part published selectors", () => {
    expect(parseLayerSelector(`acme/${DEFAULT_CATALOG_SLUG}/frontend`)).toEqual({
      scope: "published",
      org: "acme",
      catalog: DEFAULT_CATALOG_SLUG,
      name: "frontend",
    });
  });

  it("parses three-part published selectors with version", () => {
    expect(parseLayerSelector("acme/platform-personas/frontend@2.0.0")).toEqual({
      scope: "published",
      org: "acme",
      catalog: "platform-personas",
      name: "frontend",
      version: "2.0.0",
    });
  });

  it("rejects legacy two-part published selectors", () => {
    expect(() => parseLayerSelector("acme/frontend")).toThrow(/Invalid layer selector/);
  });

  it("rejects empty selectors", () => {
    expect(() => parseLayerSelector("")).toThrow(/Invalid layer selector/);
  });

  it("rejects malformed selectors", () => {
    expect(() => parseLayerSelector("@broken")).toThrow(/Invalid layer selector/);
    expect(() => parseLayerSelector("a/b/c/d")).toThrow(/Invalid layer selector/);
  });
});

describe("formatPublishedSelector", () => {
  it("uses two-part wire format for the default catalog", () => {
    expect(
      formatPublishedSelector({
        org: "acme",
        catalog: DEFAULT_CATALOG_SLUG,
        name: "frontend",
      }),
    ).toBe("acme/frontend");
  });

  it("uses three-part wire format for non-default catalogs", () => {
    expect(
      formatPublishedSelector({
        org: "acme",
        catalog: "platform-personas",
        name: "frontend",
      }),
    ).toBe("acme/platform-personas/frontend");
  });
});

describe("formatPublishedSelectorWithVersion", () => {
  it("appends version to the selector", () => {
    expect(
      formatPublishedSelectorWithVersion({
        org: "acme",
        catalog: DEFAULT_CATALOG_SLUG,
        name: "frontend",
        version: "2.0.0",
      }),
    ).toBe("acme/frontend@2.0.0");
  });
});

describe("formatCanonicalPublishedSelectorWithVersion", () => {
  it("always includes catalog even for the default catalog", () => {
    expect(
      formatCanonicalPublishedSelectorWithVersion({
        org: "harnesstap-cloud",
        catalog: DEFAULT_CATALOG_SLUG,
        name: "devops-engineer",
        version: "1.0.0",
      }),
    ).toBe("harnesstap-cloud/default/devops-engineer@1.0.0");
  });
});

describe("resolvedRemoteLayerFromCatalog", () => {
  it("maps catalog layer fields to install options", () => {
    expect(
      resolvedRemoteLayerFromCatalog({
        org: "harnesstap-cloud",
        catalog: DEFAULT_CATALOG_SLUG,
        name: "devops-engineer",
        version: "1.0.0",
      }),
    ).toEqual({
      org_slug: "harnesstap-cloud",
      catalog_slug: DEFAULT_CATALOG_SLUG,
      layer_slug: "devops-engineer",
      version: "1.0.0",
    });
  });
});

describe("resolveRemoteLayerSelector", () => {
  it("resolves published selectors to remote install fields", () => {
    expect(
      resolveRemoteLayerSelector("acme/default/frontend@1.0.0", {}),
    ).toEqual({
      org_slug: "acme",
      catalog_slug: DEFAULT_CATALOG_SLUG,
      layer_slug: "frontend",
      version: "1.0.0",
    });
  });

  it("rejects duplicate version in selector and --version", () => {
    expect(() =>
      resolveRemoteLayerSelector("acme/default/frontend@1.0.0", {
        version: "1.0.0",
      }),
    ).toThrow(/--version conflicts with version in selector/);
  });

  it("accepts browse selections that embed version only in the selector", () => {
    const selector = formatCanonicalPublishedSelectorWithVersion({
      org: "harnesstap-cloud",
      catalog: DEFAULT_CATALOG_SLUG,
      name: "fullstack",
      version: "1.0.0",
    });
    expect(resolveRemoteLayerSelector(selector, {})).toEqual({
      org_slug: "harnesstap-cloud",
      catalog_slug: DEFAULT_CATALOG_SLUG,
      layer_slug: "fullstack",
      version: "1.0.0",
    });
  });
});
