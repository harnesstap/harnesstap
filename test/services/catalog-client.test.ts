import { afterEach, describe, expect, it } from "bun:test";
import { fetchCatalogPlugin } from "../../src/services/catalog-client.js";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";

describe("fetchCatalogPlugin", () => {
  let restoreFetch: (() => void) | undefined;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  it("finds the requested plugin when the API page returns broader org matches", async () => {
    restoreFetch = createCatalogFetchMock({
      baseUrl: "https://cloud.harnesstap.com",
      plugins: [
        {
          orgSlug: "harnesstap-cloud",
          slug: "agentic-ai-engineer",
          name: "Agentic AI engineer",
          summary: "Agents",
          latestVersion: "1.0.0",
        },
        {
          orgSlug: "harnesstap-cloud",
          slug: "data-engineer",
          name: "Data engineer",
          summary: "Data engineering bundle",
          latestVersion: "1.0.0",
        },
      ],
    });

    const plugin = await fetchCatalogPlugin(
      {
        orgSlug: "harnesstap-cloud",
        catalogSlug: "default",
        slug: "data-engineer",
      },
      { baseUrl: "https://cloud.harnesstap.com" },
    );

    expect(plugin.slug).toBe("data-engineer");
    expect(plugin.summary).toBe("Data engineering bundle");
  });

  it("omits catalog plugins with no installable version from list pages", async () => {
    restoreFetch = createCatalogFetchMock({
      baseUrl: "https://cloud.harnesstap.com",
      plugins: [
        {
          orgSlug: "harnesstap-cloud",
          slug: "alive",
          name: "Alive",
          summary: "Installable",
          latestVersion: "1.0.0",
        },
        {
          orgSlug: "harnesstap-cloud",
          slug: "dead",
          name: "Dead",
          summary: "Fully yanked",
          latestVersion: null,
        },
      ],
    });

    const { listCatalogPluginsPage } = await import("../../src/services/catalog-client.js");
    const result = await listCatalogPluginsPage({}, { baseUrl: "https://cloud.harnesstap.com" });
    expect(result.plugins.map((plugin) => plugin.slug)).toEqual(["alive"]);
  });

  it("surfaces yanked package downloads instead of a generic failure", async () => {
    restoreFetch = createCatalogFetchMock({
      baseUrl: "https://cloud.harnesstap.com",
      packageStatus: 410,
      yankReason: "broken release",
    });

    const { downloadCatalogPackage, CatalogPluginYankedError } = await import(
      "../../src/services/catalog-client.js"
    );
    await expect(
      downloadCatalogPackage({
        orgSlug: "harnesstap-cloud",
        catalogSlug: "default",
        pluginSlug: "team",
        version: "1.0.0",
        baseUrl: "https://cloud.harnesstap.com",
      }),
    ).rejects.toBeInstanceOf(CatalogPluginYankedError);
  });

  it("throws when the plugin is not present in catalog pages", async () => {
    restoreFetch = createCatalogFetchMock({
      baseUrl: "https://cloud.harnesstap.com",
      plugins: [
        {
          orgSlug: "harnesstap-cloud",
          slug: "agentic-ai-engineer",
          name: "Agentic AI engineer",
          summary: "Agents",
          latestVersion: "1.0.0",
        },
      ],
    });

    await expect(
      fetchCatalogPlugin(
        {
          orgSlug: "harnesstap-cloud",
          catalogSlug: "default",
          slug: "data-engineer",
        },
        { baseUrl: "https://cloud.harnesstap.com" },
      ),
    ).rejects.toThrow("Catalog plugin not found: harnesstap-cloud/default/data-engineer");
  });
});
