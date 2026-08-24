import {
  isCatalogPluginInstallable,
  normalizeCatalogPlugin,
  type CatalogListOptions,
  type CatalogListResult,
} from "./catalog-types.js";
import { parseApEnvelope } from "./agent-plugins/envelope.js";
import type { ApPackageFiles } from "./agent-plugins/files.js";
import { AP_PACKAGE_MEDIA_TYPE, cloudFetch } from "./cloud-api-version.js";
import { throwIfCatalogPackageYanked } from "./catalog-package-errors.js";
import { DEFAULT_CATALOG_SLUG } from "./plugin-selector.js";

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
    plugins: result.plugins
      .map((plugin) => normalizeCatalogPlugin(plugin))
      .filter((plugin) => isCatalogPluginInstallable(plugin)),
  };
}

export function createPublicCatalogClient(baseUrl: string) {
  const root = baseUrl.replace(/\/+$/, "");

  return {
    async listPlugins(options: CatalogListOptions = {}): Promise<CatalogListResult> {
      const params = buildSearchParams(options);
      const url = `${root}/api/public/plugins?${params.toString()}`;
      const response = await cloudFetch(url);
      if (!response.ok) {
        throw new Error(`Failed to list public plugins: ${response.status}`);
      }
      const result = await response.json() as CatalogListResult;
      return normalizeListResult(result);
    },

    async downloadPackage(
      orgSlug: string,
      pluginSlug: string,
      version = "latest",
      catalogSlug = DEFAULT_CATALOG_SLUG,
    ): Promise<{ version: string; files: ApPackageFiles }> {
      const encodedVersion = encodeURIComponent(version);
      const url =
        `${root}/api/public/${encodeURIComponent(orgSlug)}` +
        `/${encodeURIComponent(catalogSlug)}/${encodeURIComponent(pluginSlug)}` +
        `/versions/${encodedVersion}/package`;
      const response = await cloudFetch(url, {
        headers: { Accept: AP_PACKAGE_MEDIA_TYPE },
      });
      await throwIfCatalogPackageYanked(
        response,
        `${orgSlug}/${catalogSlug}/${pluginSlug}@${version}`,
      );
      if (!response.ok) {
        throw new Error(
          `Failed to download ${orgSlug}/${catalogSlug}/${pluginSlug}: ${response.status}`,
        );
      }
      return {
        version,
        files: parseApEnvelope(await response.text(), url),
      };
    },
  };
}

export type PublicCatalogClient = ReturnType<typeof createPublicCatalogClient>;
