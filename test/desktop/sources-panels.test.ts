import { describe, expect, test } from "bun:test";
import {
  connectCatalogDraftIsDirty,
  marketplaceDraftIsDirty,
  marketplaceSubmitCloseAction,
} from "../../apps/desktop/src/lib/sources-panels.ts";

describe("marketplaceSubmitCloseAction", () => {
  test("stays open with a warning when refresh failed", () => {
    expect(
      marketplaceSubmitCloseAction({ ok: false, message: "clone failed" }),
    ).toBe("stay-warning");
  });

  test("closes when refresh succeeded or was not returned", () => {
    expect(
      marketplaceSubmitCloseAction({ ok: true, message: "refreshed" }),
    ).toBe("close");
    expect(marketplaceSubmitCloseAction(undefined)).toBe("close");
  });
});

describe("marketplaceDraftIsDirty", () => {
  test("add is dirty once a URL or name is typed", () => {
    expect(
      marketplaceDraftIsDirty({
        url: "",
        name: "",
        platforms: ["claude-code"],
        baselineUrl: "",
        baselineName: "",
        baselinePlatforms: ["claude-code"],
      }),
    ).toBe(false);
    expect(
      marketplaceDraftIsDirty({
        url: "https://github.com/org/demo",
        name: "demo",
        platforms: ["claude-code"],
        baselineUrl: "",
        baselineName: "",
        baselinePlatforms: ["claude-code"],
      }),
    ).toBe(true);
  });

  test("edit is dirty when url, name, or platforms differ from the entry", () => {
    const baseline = {
      baselineUrl: "https://github.com/org/demo",
      baselineName: "demo",
      baselinePlatforms: ["claude-code"],
    };
    expect(
      marketplaceDraftIsDirty({
        url: "https://github.com/org/demo",
        name: "demo",
        platforms: ["claude-code"],
        ...baseline,
      }),
    ).toBe(false);
    expect(
      marketplaceDraftIsDirty({
        url: "https://github.com/org/other",
        name: "demo",
        platforms: ["claude-code"],
        ...baseline,
      }),
    ).toBe(true);
    expect(
      marketplaceDraftIsDirty({
        url: "https://github.com/org/demo",
        name: "demo",
        platforms: ["claude-code", "cursor"],
        ...baseline,
      }),
    ).toBe(true);
  });
});

describe("connectCatalogDraftIsDirty", () => {
  test("is dirty only when a field has typed text", () => {
    expect(
      connectCatalogDraftIsDirty({ selector: "", account: "", org: "" }),
    ).toBe(false);
    expect(
      connectCatalogDraftIsDirty({ selector: "acme/internal", account: "", org: "" }),
    ).toBe(true);
    expect(
      connectCatalogDraftIsDirty({ selector: "", account: "default", org: "" }),
    ).toBe(true);
    expect(
      connectCatalogDraftIsDirty({ selector: "", account: "", org: "acme" }),
    ).toBe(true);
  });
});
