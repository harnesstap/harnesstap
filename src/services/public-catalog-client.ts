import type { CatalogListOptions, CatalogListResult } from "./catalog-types.js";

function buildSearchParams(options: CatalogListOptions): URLSearchParams {
  const params = new URLSearchParams();
  if (options.q?.trim()) params.set("q", options.q.trim());
  if (options.tag?.trim()) params.set("tag", options.tag.trim());
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

export function createPublicCatalogClient(baseUrl: string) {
  const root = baseUrl.replace(/\/+$/, "");

  return {
    async listLibraries(options: CatalogListOptions = {}): Promise<CatalogListResult> {
      const params = buildSearchParams(options);
      const url = `${root}/api/public/libraries?${params.toString()}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to list public libraries: ${response.status}`);
      }
      return await response.json() as CatalogListResult;
    },

    async downloadBundle(
      orgSlug: string,
      librarySlug: string,
      version = "latest",
    ): Promise<{ version: string; body: string }> {
      const encodedVersion = encodeURIComponent(version);
      const url = `${root}/api/public/${encodeURIComponent(orgSlug)}/${encodeURIComponent(librarySlug)}/versions/${encodedVersion}/bundle`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download public bundle: ${response.status}`);
      }
      const body = await response.text();
      return { version, body };
    },
  };
}

export type PublicCatalogClient = ReturnType<typeof createPublicCatalogClient>;
