import { describe, expect, it } from "bun:test";
import {
  DEFAULT_CATALOG_SLUG,
  formatCanonicalPublishedSelectorWithVersion,
  formatPublishedSelector,
  formatPublishedSelectorWithVersion,
  parsePluginSelector,
  resolveRemotePluginSelector,
  resolvedRemotePluginFromCatalog,
} from "../../src/services/plugin-selector.js";

describe("parsePluginSelector", () => {
  it("parses local name-only selectors", () => {
    expect(parsePluginSelector("frontend")).toEqual({
      scope: "local",
      name: "frontend",
    });
  });

  it("parses local name@version selectors", () => {
    expect(parsePluginSelector("frontend@2.0.0")).toEqual({
      scope: "local",
      name: "frontend",
      version: "2.0.0",
    });
  });

  it("parses three-part published selectors", () => {
    expect(parsePluginSelector(`acme/${DEFAULT_CATALOG_SLUG}/frontend`)).toEqual({
      scope: "published",
      org: "acme",
      catalog: DEFAULT_CATALOG_SLUG,
      name: "frontend",
    });
  });

  it("parses three-part published selectors with version", () => {
    expect(parsePluginSelector("acme/platform-personas/frontend@2.0.0")).toEqual({
      scope: "published",
      org: "acme",
      catalog: "platform-personas",
      name: "frontend",
      version: "2.0.0",
    });
  });

  it("rejects legacy two-part published selectors", () => {
    expect(() => parsePluginSelector("acme/frontend")).toThrow(/Invalid plugin selector/);
  });

  it("rejects empty selectors", () => {
    expect(() => parsePluginSelector("")).toThrow(/Invalid plugin selector/);
  });

  it("rejects malformed selectors", () => {
    expect(() => parsePluginSelector("@broken")).toThrow(/Invalid plugin selector/);
    expect(() => parsePluginSelector("a/b/c/d")).toThrow(/Invalid plugin selector/);
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

describe("resolvedRemotePluginFromCatalog", () => {
  it("maps catalog plugin fields to install options", () => {
    expect(
      resolvedRemotePluginFromCatalog({
        org: "harnesstap-cloud",
        catalog: DEFAULT_CATALOG_SLUG,
        name: "devops-engineer",
        version: "1.0.0",
      }),
    ).toEqual({
      org_slug: "harnesstap-cloud",
      catalog_slug: DEFAULT_CATALOG_SLUG,
      plugin_slug: "devops-engineer",
      version: "1.0.0",
    });
  });
});

describe("resolveRemotePluginSelector", () => {
  it("resolves published selectors to remote install fields", () => {
    expect(
      resolveRemotePluginSelector("acme/default/frontend@1.0.0", {}),
    ).toEqual({
      org_slug: "acme",
      catalog_slug: DEFAULT_CATALOG_SLUG,
      plugin_slug: "frontend",
      version: "1.0.0",
    });
  });

  it("rejects duplicate version in selector and --version", () => {
    expect(() =>
      resolveRemotePluginSelector("acme/default/frontend@1.0.0", {
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
    expect(resolveRemotePluginSelector(selector, {})).toEqual({
      org_slug: "harnesstap-cloud",
      catalog_slug: DEFAULT_CATALOG_SLUG,
      plugin_slug: "fullstack",
      version: "1.0.0",
    });
  });
});
