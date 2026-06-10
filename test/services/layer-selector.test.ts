import { describe, expect, it } from "bun:test";
import {
  DEFAULT_CATALOG_SLUG,
  formatPublishedSelector,
  formatPublishedSelectorWithVersion,
  parseLayerSelector,
  resolveRemoteLayerSelector,
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

  it("parses two-part published selectors with default catalog", () => {
    expect(parseLayerSelector("acme/frontend")).toEqual({
      scope: "published",
      org: "acme",
      catalog: DEFAULT_CATALOG_SLUG,
      name: "frontend",
    });
  });

  it("parses two-part published selectors with version", () => {
    expect(parseLayerSelector("acme/frontend@2.0.0")).toEqual({
      scope: "published",
      org: "acme",
      catalog: DEFAULT_CATALOG_SLUG,
      name: "frontend",
      version: "2.0.0",
    });
  });

  it("parses three-part published selectors", () => {
    expect(parseLayerSelector("acme/platform-personas/frontend@2.0.0")).toEqual({
      scope: "published",
      org: "acme",
      catalog: "platform-personas",
      name: "frontend",
      version: "2.0.0",
    });
  });

  it("rejects empty selectors", () => {
    expect(() => parseLayerSelector("")).toThrow(/Invalid library selector/);
  });

  it("rejects malformed selectors", () => {
    expect(() => parseLayerSelector("@broken")).toThrow(/Invalid library selector/);
    expect(() => parseLayerSelector("a/b/c/d")).toThrow(/Invalid library selector/);
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

  it("appends version when requested", () => {
    expect(
      formatPublishedSelectorWithVersion({
        org: "acme",
        catalog: "platform-personas",
        name: "frontend",
        version: "2.0.0",
      }),
    ).toBe("acme/platform-personas/frontend@2.0.0");
  });
});

describe("resolveRemoteLayerSelector", () => {
  it("fills org and catalog from flags for local selectors", () => {
    expect(
      resolveRemoteLayerSelector("my-library", {
        org: "harnessdeck-cloud",
        version: "^1.0.0",
      }),
    ).toEqual({
      org_slug: "harnessdeck-cloud",
      catalog_slug: DEFAULT_CATALOG_SLUG,
      library_slug: "my-library",
      version: "^1.0.0",
    });
  });

  it("resolves three-part published selectors", () => {
    expect(resolveRemoteLayerSelector("acme/personas/frontend@1.0.0", {})).toEqual({
      org_slug: "acme",
      catalog_slug: "personas",
      library_slug: "frontend",
      version: "1.0.0",
    });
  });

  it("rejects conflicting org flags", () => {
    expect(() =>
      resolveRemoteLayerSelector("acme/library", { org: "other-org" }),
    ).toThrow("--org conflicts with org in selector");
  });

  it("rejects conflicting version flags", () => {
    expect(() =>
      resolveRemoteLayerSelector("acme/library@1.0.0", { version: "^2.0.0" }),
    ).toThrow("--version conflicts with version in selector");
  });

  it("requires org for local selectors", () => {
    expect(() => resolveRemoteLayerSelector("library-name", {})).toThrow("org is required");
  });
});
