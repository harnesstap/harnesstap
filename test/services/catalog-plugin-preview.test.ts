import { afterEach, describe, expect, it } from "bun:test";
import { listPlugins } from "../../src/models/plugin-model.js";
import { renderCatalogPluginPreviewShow } from "../../src/services/catalog-plugin-preview.js";
import type { CatalogPlugin } from "../../src/services/catalog-types.js";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

const catalogPlugin: CatalogPlugin = {
  orgSlug: "harnesstap-cloud",
  catalogSlug: "default",
  slug: "remote-team",
  name: "Remote team",
  summary: "from cloud",
  latestVersion: "1.0.0",
  updatedAt: "2026-01-03T00:00:00.000Z",
  tags: ["team"],
  visibility: "public",
};

describe("renderCatalogPluginPreviewShow", () => {
  let restoreFetch: (() => void) | undefined;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  it("renders full plugin show output without keeping a preview install", async () => {
    const context = await createInitializedTestContext("catalog-plugin-preview");
    restoreFetch = createCatalogFetchMock({
      baseUrl: "https://cloud.harnesstap.com",
      plugins: [catalogPlugin],
    });

    try {
      const beforeCount = listPlugins().length;
      const output = await renderCatalogPluginPreviewShow(catalogPlugin, {
        baseUrl: "https://cloud.harnesstap.com",
      });

      expect(output).toContain("PLUGIN");
      expect(output).toContain("harnesstap-cloud/default/remote-team@1.0.0");
      expect(output).toContain("from cloud");
      expect(output).toContain("RESOURCES");
      expect(output).toContain("skill");
      expect(listPlugins()).toHaveLength(beforeCount);
      expect(listPlugins().every((plugin) => !plugin.name.startsWith("__hd-preview-"))).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
