import { describe, expect, it } from "bun:test";
import {
  loadRegisteredCatalogs,
  parsePublishCatalogSelector,
  registerPublishCatalog,
  unregisterPublishCatalog,
} from "../../src/config/catalog.js";
import { createTestContext } from "../helpers/db.ts";

describe("catalog registered publish targets", () => {
  it("parses org/catalog and account@org/catalog selectors", () => {
    expect(parsePublishCatalogSelector("acme/internal")).toEqual({
      org: "acme",
      catalog: "internal",
    });
    expect(parsePublishCatalogSelector("work@acme/platform-personas")).toEqual({
      org: "acme",
      catalog: "platform-personas",
      account: "work",
    });
  });

  it("registers and unregisters publish catalogs idempotently", async () => {
    const context = await createTestContext("catalog-registered");
    try {
      const first = registerPublishCatalog("acme/internal", context.homeDir);
      expect(first.created).toBe(true);
      expect(loadRegisteredCatalogs(context.homeDir)).toEqual([
        { org: "acme", catalog: "internal" },
      ]);

      const second = registerPublishCatalog("acme/internal", context.homeDir);
      expect(second.created).toBe(false);

      unregisterPublishCatalog("acme/internal", context.homeDir);
      expect(loadRegisteredCatalogs(context.homeDir)).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });
});
