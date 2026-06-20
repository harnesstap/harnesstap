import {
  normalizeCatalogLayer,
  type CatalogListOptions,
  type CatalogListResult,
} from "./catalog-types.js";
import { DEFAULT_CATALOG_SLUG } from "./layer-selector.js";
import { fetchWithTimeout } from "./transport/fetch-with-timeout.js";

function buildSearchParams(options: CatalogListOptions): URLSearchParams {
  const params = new URLSearchParams();
  if (options.q?.trim()) params.set("q", options.q.trim());
  if (options.tag?.trim()) params.set("tag", options.tag.trim());
  if (options.catalog?.trim()) params.set("catalog", options.catalog.trim());
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.sort) params.set("sort", options.sort);
  for (const org of options.orgs ?? []) {
    params.append("org", org);
  }
  for (const selector of options.selectors ?? []) {
    params.append("selector", selector);
  }
  return params;
}

function normalizeListResult(result: CatalogListResult): CatalogListResult {
  return {
    ...result,
    layers: result.layers.map((layer) => normalizeCatalogLayer(layer)),
  };
}

export function createPublicCatalogClient(baseUrl: string) {
  const root = baseUrl.replace(/\/+$/, "");

  return {
    async listLayers(options: CatalogListOptions = {}): Promise<CatalogListResult> {
      const params = buildSearchParams(options);
      const url = `${root}/api/public/layers?${params.toString()}`;
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`Failed to list public layers: ${response.status}`);
      }
      const result = await response.json() as CatalogListResult;
      return normalizeListResult(result);
    },

    async downloadBundle(
      orgSlug: string,
      layerSlug: string,
      version = "latest",
      catalogSlug = DEFAULT_CATALOG_SLUG,
    ): Promise<{ version: string; body: string }> {
      const encodedVersion = encodeURIComponent(version);
      const url = catalogSlug === DEFAULT_CATALOG_SLUG
        ? `${root}/api/public/${encodeURIComponent(orgSlug)}/${encodeURIComponent(layerSlug)}/versions/${encodedVersion}/layer-export`
        : `${root}/api/public/${encodeURIComponent(orgSlug)}/${encodeURIComponent(catalogSlug)}/${encodeURIComponent(layerSlug)}/versions/${encodedVersion}/layer-export`;
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`Failed to download public layer export: ${response.status}`);
      }
      const body = await response.text();
      return { version, body };
    },
  };
}

export type PublicCatalogClient = ReturnType<typeof createPublicCatalogClient>;
