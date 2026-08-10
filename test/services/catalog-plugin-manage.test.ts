import { describe, expect, it } from "bun:test";
import type { CatalogPlugin } from "../../src/services/catalog-types.js";
import {
  findLocalPluginForCatalogEntry,
  isCatalogPluginManageable,
} from "../../src/services/catalog-plugin-manage.js";
import { getDb } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";
import { createPlugin } from "../../src/models/plugin-model.js";
import { createTestContext } from "../helpers/db.ts";

const catalogPlugin: CatalogPlugin = {
  orgSlug: "acme",
  catalogSlug: "default",
  slug: "team-stack",
  name: "Team Stack",
  summary: "Team baseline",
  latestVersion: "1.0.0",
  updatedAt: "2026-01-03T00:00:00.000Z",
  tags: [],
  visibility: "organization",
  pluginId: "remote-plugin-1",
  orgId: "org-acme",
  manageable: true,
};

describe("catalog plugin manage helpers", () => {
  it("detects manageable catalog plugins", () => {
    expect(isCatalogPluginManageable(catalogPlugin)).toBe(true);
    expect(isCatalogPluginManageable({ ...catalogPlugin, manageable: false })).toBe(false);
    expect(isCatalogPluginManageable({ ...catalogPlugin, pluginId: undefined })).toBe(false);
  });

  it("finds a local plugin linked to a catalog entry", async () => {
    const context = await createTestContext("catalog-plugin-manage-find-local");
    try {
      initializeSchema(getDb());
      const plugin = createPlugin({
        name: "team-stack",
        version: "1.0.0",
        org_slug: "acme",
        catalog_slug: "default",
      });
      expect(findLocalPluginForCatalogEntry(catalogPlugin)?.id).toBe(plugin.id);
    } finally {
      await context.cleanup();
    }
  });
});
