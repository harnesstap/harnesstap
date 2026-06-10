import { getCloudProfile } from "../config/cloud-profiles.js";
import {
  formatOutOfScopeMessage,
  isSelectorInCatalogScope,
  resolveCatalogScope,
  type CatalogScope,
} from "../config/catalog.js";
import {
  normalizeCatalogLibrary,
  type CatalogLibrary,
  type CatalogListOptions,
  type CatalogListResult,
} from "./catalog-types.js";
import {
  formatPublishedSelector,
  parseLayerSelector,
} from "./layer-selector.js";
import { createPublicCatalogClient } from "./public-catalog-client.js";

function buildScopeParams(scope: CatalogScope, options: CatalogListOptions): CatalogListOptions {
  return {
    ...options,
    orgs: options.orgs ?? scope.orgs,
    selectors: options.selectors ?? scope.selectors,
  };
}

function catalogLibraryKey(library: CatalogLibrary): string {
  return `${library.orgSlug}/${library.catalogSlug}/${library.slug}`;
}

function dedupeCatalogLibraries(libraries: CatalogLibrary[]): CatalogLibrary[] {
  const byKey = new Map<string, CatalogLibrary>();
  const visibilityRank = { organization: 3, shared: 2, public: 1 } as const;
  for (const library of libraries) {
    const key = catalogLibraryKey(library);
    const existing = byKey.get(key);
    if (!existing || visibilityRank[library.visibility] > visibilityRank[existing.visibility]) {
      byKey.set(key, library);
    }
  }
  return [...byKey.values()];
}

function sortCatalogLibraries(
  libraries: CatalogLibrary[],
  sort: "updated" | "name" = "updated",
): CatalogLibrary[] {
  const sorted = [...libraries];
  if (sort === "name") {
    sorted.sort((left, right) => {
      const byOrg = left.orgSlug.localeCompare(right.orgSlug);
      if (byOrg !== 0) return byOrg;
      const byCatalog = left.catalogSlug.localeCompare(right.catalogSlug);
      if (byCatalog !== 0) return byCatalog;
      return left.name.localeCompare(right.name);
    });
    return sorted;
  }

  sorted.sort((left, right) => {
    const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : 0;
    const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : 0;
    if (rightTime !== leftTime) return rightTime - leftTime;
    const byOrg = left.orgSlug.localeCompare(right.orgSlug);
    if (byOrg !== 0) return byOrg;
    const byCatalog = left.catalogSlug.localeCompare(right.catalogSlug);
    if (byCatalog !== 0) return byCatalog;
    return left.name.localeCompare(right.name);
  });
  return sorted;
}

function normalizeListResult(result: CatalogListResult): CatalogListResult {
  return {
    ...result,
    libraries: result.libraries.map((library) => normalizeCatalogLibrary(library)),
  };
}

async function createAuthenticatedCatalogClient(baseUrl: string, accessToken: string) {
  const root = baseUrl.replace(/\/+$/, "");

  return {
    async listLibraries(options: CatalogListOptions = {}): Promise<CatalogListResult> {
      const params = new URLSearchParams();
      if (options.q?.trim()) params.set("q", options.q.trim());
      if (options.tag?.trim()) params.set("tag", options.tag.trim());
      if (options.catalog?.trim()) params.set("catalog", options.catalog.trim());
      if (options.limit != null) params.set("limit", String(options.limit));
      if (options.cursor) params.set("cursor", options.cursor);
      if (options.sort) params.set("sort", options.sort);
      for (const org of options.orgs ?? []) params.append("org", org);
      for (const selector of options.selectors ?? []) params.append("selector", selector);

      const response = await fetch(`${root}/api/catalog/libraries?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to list catalog libraries: ${response.status}`);
      }
      const result = await response.json() as CatalogListResult;
      return normalizeListResult(result);
    },
  };
}

export async function resolveCatalogAccess(input?: {
  profile?: string;
  baseUrl?: string;
}) {
  const scope = resolveCatalogScope({ baseUrl: input?.baseUrl });
  const profileInfo = await getCloudProfile(input?.profile);
  const accessToken = profileInfo.profile?.accessToken;
  const publicClient = createPublicCatalogClient(scope.cloudBaseUrl);
  const authenticatedClient = accessToken
    ? await createAuthenticatedCatalogClient(scope.cloudBaseUrl, accessToken)
    : null;

  return {
    scope,
    isAuthenticated: Boolean(authenticatedClient),
    publicClient,
    authenticatedClient,
  };
}

export async function listLibrariesInScope(
  options: CatalogListOptions = {},
  input?: { profile?: string; baseUrl?: string },
): Promise<CatalogLibrary[]> {
  const access = await resolveCatalogAccess(input);
  const scopedOptions = buildScopeParams(access.scope, options);

  if (access.authenticatedClient) {
    const result = await access.authenticatedClient.listLibraries(scopedOptions);
    return result.libraries;
  }

  const orgScopedLibraries: CatalogLibrary[] = [];
  const selectorsOnly = (scopedOptions.selectors ?? []).filter((selector) => {
    const parsed = parseLayerSelector(selector);
    if (parsed.scope !== "published") {
      return true;
    }
    return !scopedOptions.orgs?.includes(parsed.org);
  });

  if ((scopedOptions.orgs ?? []).length > 0) {
    const result = await access.publicClient.listLibraries({
      ...scopedOptions,
      selectors: [],
      limit: scopedOptions.limit ?? (scopedOptions.q?.trim() ? 25 : 10),
    });
    orgScopedLibraries.push(...result.libraries);
  }

  if (selectorsOnly.length > 0) {
    const result = await access.publicClient.listLibraries({
      ...scopedOptions,
      orgs: [],
      selectors: selectorsOnly,
      limit: scopedOptions.limit ?? (scopedOptions.q?.trim() ? 25 : 10),
    });
    orgScopedLibraries.push(...result.libraries);
  }

  const deduped = dedupeCatalogLibraries(orgScopedLibraries);
  const limit = scopedOptions.limit ?? (scopedOptions.q?.trim() ? 25 : 10);
  return sortCatalogLibraries(deduped, scopedOptions.sort).slice(0, limit);
}

export async function downloadCatalogBundle(input: {
  orgSlug: string;
  catalogSlug?: string;
  librarySlug: string;
  version?: string;
  profile?: string;
  baseUrl?: string;
}): Promise<{ version: string; body: string }> {
  const catalogSlug = input.catalogSlug ?? "default";
  const access = await resolveCatalogAccess({
    profile: input.profile,
    baseUrl: input.baseUrl,
  });
  const version = input.version ?? "latest";
  const selector = formatPublishedSelector({
    org: input.orgSlug,
    catalog: catalogSlug,
    name: input.librarySlug,
  });
  const inScope = isSelectorInCatalogScope(
    {
      orgSlug: input.orgSlug,
      catalogSlug,
      librarySlug: input.librarySlug,
    },
    access.scope,
  );

  if (!inScope && !access.isAuthenticated) {
    throw new Error(formatOutOfScopeMessage(selector));
  }

  const profileInfo = await getCloudProfile(input.profile);
  const accessToken = profileInfo.profile?.accessToken;
  if (accessToken) {
    const encodedVersion = encodeURIComponent(version);
    const url = catalogSlug === "default"
      ? `${access.scope.cloudBaseUrl}/api/catalog/${encodeURIComponent(input.orgSlug)}/${encodeURIComponent(input.librarySlug)}/versions/${encodedVersion}/bundle`
      : `${access.scope.cloudBaseUrl}/api/catalog/${encodeURIComponent(input.orgSlug)}/${encodeURIComponent(catalogSlug)}/${encodeURIComponent(input.librarySlug)}/versions/${encodedVersion}/bundle`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (response.ok) {
      return { version, body: await response.text() };
    }
    if (response.status !== 404) {
      throw new Error(`Failed to download catalog bundle: ${response.status}`);
    }
  }

  if (!inScope) {
    throw new Error(formatOutOfScopeMessage(selector));
  }

  return access.publicClient.downloadBundle(
    input.orgSlug,
    input.librarySlug,
    version,
    catalogSlug,
  );
}

export async function validatePublicOrgHasLibraries(orgSlug: string, baseUrl?: string): Promise<boolean> {
  const client = createPublicCatalogClient(resolveCatalogScope({ baseUrl }).cloudBaseUrl);
  const result = await client.listLibraries({ orgs: [orgSlug], limit: 1 });
  return result.libraries.length > 0;
}

export async function validatePublicLibraryExists(
  selector: string,
  baseUrl?: string,
): Promise<boolean> {
  const client = createPublicCatalogClient(resolveCatalogScope({ baseUrl }).cloudBaseUrl);
  const result = await client.listLibraries({ selectors: [selector], limit: 1 });
  const parsed = parseLayerSelector(selector);
  if (parsed.scope !== "published") {
    return false;
  }
  return result.libraries.some((library) =>
    library.orgSlug === parsed.org
    && library.catalogSlug === parsed.catalog
    && library.slug === parsed.name,
  );
}
