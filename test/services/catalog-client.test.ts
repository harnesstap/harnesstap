import { afterEach, describe, expect, it } from "bun:test";
import { fetchCatalogLayer } from "../../src/services/catalog-client.js";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";

describe("fetchCatalogLayer", () => {
  let restoreFetch: (() => void) | undefined;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  it("finds the requested layer when the API page returns broader org matches", async () => {
    restoreFetch = createCatalogFetchMock({
      baseUrl: "https://cloud.harnesstap.com",
      layers: [
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

    const layer = await fetchCatalogLayer(
      {
        orgSlug: "harnesstap-cloud",
        catalogSlug: "default",
        slug: "data-engineer",
      },
      { baseUrl: "https://cloud.harnesstap.com" },
    );

    expect(layer.slug).toBe("data-engineer");
    expect(layer.summary).toBe("Data engineering bundle");
  });

  it("throws when the layer is not present in catalog pages", async () => {
    restoreFetch = createCatalogFetchMock({
      baseUrl: "https://cloud.harnesstap.com",
      layers: [
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
      fetchCatalogLayer(
        {
          orgSlug: "harnesstap-cloud",
          catalogSlug: "default",
          slug: "data-engineer",
        },
        { baseUrl: "https://cloud.harnesstap.com" },
      ),
    ).rejects.toThrow("Catalog layer not found: harnesstap-cloud/default/data-engineer");
  });
});
