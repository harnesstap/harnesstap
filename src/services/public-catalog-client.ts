import {
  normalizeCatalogPlugin,
  type CatalogListOptions,
  type CatalogListResult,
} from "./catalog-types.js";
import { DEFAULT_CATALOG_SLUG } from "./plugin-selector.js";
import { fetchWithTimeout } from "../utils/fetch-with-timeout.js";

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
    plugins: result.plugins.map((plugin) => normalizeCatalogPlugin(plugin)),
  };
}

export function createPublicCatalogClient(baseUrl: string) {
  const root = baseUrl.replace(/\/+$/, "");

  return {
    async listPlugins(options: CatalogListOptions = {}): Promise<CatalogListResult> {
      const params = buildSearchParams(options);
      const url = `${root}/api/public/plugins?${params.toString()}`;
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`Failed to list public plugins: ${response.status}`);
      }
      const result = await response.json() as CatalogListResult;
      return normalizeListResult(result);
    },

    async downloadBundle(
      orgSlug: string,
      pluginSlug: string,
      version = "latest",
      catalogSlug = DEFAULT_CATALOG_SLUG,
    ): Promise<{ version: string; body: string }> {
      const encodedVersion = encodeURIComponent(version);
      const url = catalogSlug === DEFAULT_CATALOG_SLUG
        ? `${root}/api/public/${encodeURIComponent(orgSlug)}/${encodeURIComponent(pluginSlug)}/versions/${encodedVersion}/plugin-export`
        : `${root}/api/public/${encodeURIComponent(orgSlug)}/${encodeURIComponent(catalogSlug)}/${encodeURIComponent(pluginSlug)}/versions/${encodedVersion}/plugin-export`;
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`Failed to download public plugin export: ${response.status}`);
      }
      const body = await response.text();
      return { version, body };
    },
  };
}

export type PublicCatalogClient = ReturnType<typeof createPublicCatalogClient>;
