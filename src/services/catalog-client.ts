import { getCloudAccount } from "../config/cloud-accounts.js";
import {
  formatOutOfScopeMessage,
  isSelectorInCatalogScope,
  resolveCatalogScope,
  type CatalogScope,
} from "../config/catalog.js";
import {
  normalizeCatalogLayer,
  type CatalogLayer,
  type CatalogListOptions,
  type CatalogListResult,
} from "./catalog-types.js";
import {
  formatCanonicalPublishedSelector,
  formatPublishedSelector,
  parseLayerSelector,
} from "./layer-selector.js";
import { createPublicCatalogClient } from "./public-catalog-client.js";
import { rankCatalogSearchResults } from "./catalog-search-rank.js";
import { fetchWithTimeout, formatCatalogRequestError } from "./transport/fetch-with-timeout.js";

function buildScopeParams(scope: CatalogScope, options: CatalogListOptions): CatalogListOptions {
  return {
    ...options,
    orgs: options.orgs ?? scope.orgs,
    selectors: options.selectors ?? scope.selectors,
  };
}

function catalogLayerKey(layer: Pick<CatalogLayer, "orgSlug" | "catalogSlug" | "slug">): string {
  return `${layer.orgSlug}/${layer.catalogSlug}/${layer.slug}`;
}

function dedupeCatalogLayers(layers: CatalogLayer[]): CatalogLayer[] {
  const byKey = new Map<string, CatalogLayer>();
  const visibilityRank = { organization: 3, shared: 2, public: 1 } as const;
  for (const layer of layers) {
    const key = catalogLayerKey(layer);
    const existing = byKey.get(key);
    if (!existing || visibilityRank[layer.visibility] > visibilityRank[existing.visibility]) {
      byKey.set(key, layer);
    }
  }
  return [...byKey.values()];
}

function sortCatalogLayers(
  layers: CatalogLayer[],
  sort: "updated" | "name" = "updated",
): CatalogLayer[] {
  const sorted = [...layers];
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
    layers: result.layers.map((layer) => normalizeCatalogLayer(layer)),
  };
}

async function createAuthenticatedCatalogClient(baseUrl: string, accessToken: string) {
  const root = baseUrl.replace(/\/+$/, "");

  return {
    async listLayers(options: CatalogListOptions = {}): Promise<CatalogListResult> {
      const params = new URLSearchParams();
      if (options.q?.trim()) params.set("q", options.q.trim());
      if (options.tag?.trim()) params.set("tag", options.tag.trim());
      if (options.catalog?.trim()) params.set("catalog", options.catalog.trim());
      if (options.limit != null) params.set("limit", String(options.limit));
      if (options.cursor) params.set("cursor", options.cursor);
      if (options.sort) params.set("sort", options.sort);
      for (const org of options.orgs ?? []) params.append("org", org);
      for (const selector of options.selectors ?? []) params.append("selector", selector);

      const response = await fetchWithTimeout(`${root}/api/catalog/layers?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to list catalog layers: ${response.status}`);
      }
      const result = await response.json() as CatalogListResult;
      return normalizeListResult(result);
    },
  };
}

export async function resolveCatalogAccess(input?: {
  account?: string;
  baseUrl?: string;
}) {
  const scope = resolveCatalogScope({ baseUrl: input?.baseUrl });
  const accountInfo = await getCloudAccount(input?.account);
  const accessToken = accountInfo.account?.accessToken;
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

export async function listCatalogLayersPage(
  options: CatalogListOptions = {},
  input?: { account?: string; baseUrl?: string },
): Promise<CatalogListResult> {
  try {
    const access = await resolveCatalogAccess(input);
    const scopedOptions = buildScopeParams(access.scope, options);

    if (input?.account) {
      const accountInfo = await getCloudAccount(input.account);
      const accessToken = accountInfo.account?.accessToken;
      if (accessToken) {
        const client = await createAuthenticatedCatalogClient(access.scope.cloudBaseUrl, accessToken);
        return await client.listLayers(scopedOptions);
      }
      return await access.publicClient.listLayers(scopedOptions);
    }

    if (access.authenticatedClient) {
      return await access.authenticatedClient.listLayers(scopedOptions);
    }

    return await access.publicClient.listLayers(scopedOptions);
  } catch (error) {
    throw new Error(formatCatalogRequestError(error), { cause: error });
  }
}

export async function fetchCatalogLayer(
  layer: Pick<CatalogLayer, "orgSlug" | "catalogSlug" | "slug">,
  input?: { account?: string; baseUrl?: string },
): Promise<CatalogLayer> {
  const key = catalogLayerKey(layer);
  const selector = formatCanonicalPublishedSelector({
    org: layer.orgSlug,
    catalog: layer.catalogSlug,
    name: layer.slug,
  });

  let cursor: string | null = null;
  do {
    const result = await listCatalogLayersPage(
      {
        selectors: [selector],
        orgs: [layer.orgSlug],
        catalog: layer.catalogSlug,
        limit: 50,
        cursor,
      },
      input,
    );
    const found = result.layers.find((candidate) => catalogLayerKey(candidate) === key);
    if (found) {
      return found;
    }
    cursor = result.nextCursor;
  } while (cursor);

  throw new Error(`Catalog layer not found: ${key}`);
}

export async function listLayersInScope(
  options: CatalogListOptions = {},
  input?: { account?: string; baseUrl?: string },
): Promise<CatalogLayer[]> {
  const access = await resolveCatalogAccess(input);
  const scopedOptions = buildScopeParams(access.scope, options);

  if (access.authenticatedClient) {
    const result = await access.authenticatedClient.listLayers(scopedOptions);
    return result.layers;
  }

  const orgScopedLayers: CatalogLayer[] = [];
  const selectorsOnly = (scopedOptions.selectors ?? []).filter((selector) => {
    const parsed = parseLayerSelector(selector);
    if (parsed.scope !== "published") {
      return true;
    }
    return !scopedOptions.orgs?.includes(parsed.org);
  });

  if ((scopedOptions.orgs ?? []).length > 0) {
    const result = await access.publicClient.listLayers({
      ...scopedOptions,
      selectors: [],
      limit: scopedOptions.limit ?? (scopedOptions.q?.trim() ? 25 : 10),
    });
    orgScopedLayers.push(...result.layers);
  }

  if (selectorsOnly.length > 0) {
    const result = await access.publicClient.listLayers({
      ...scopedOptions,
      orgs: [],
      selectors: selectorsOnly,
      limit: scopedOptions.limit ?? (scopedOptions.q?.trim() ? 25 : 10),
    });
    orgScopedLayers.push(...result.layers);
  }

  const deduped = dedupeCatalogLayers(orgScopedLayers);
  const limit = scopedOptions.limit ?? (scopedOptions.q?.trim() ? 25 : 10);
  const ordered = scopedOptions.q?.trim()
    ? rankCatalogSearchResults(deduped, scopedOptions.q)
    : sortCatalogLayers(deduped, scopedOptions.sort);
  return ordered.slice(0, limit);
}

export async function downloadCatalogBundle(input: {
  orgSlug: string;
  catalogSlug?: string;
  layerSlug: string;
  version?: string;
  account?: string;
  baseUrl?: string;
}): Promise<{ version: string; body: string }> {
  const catalogSlug = input.catalogSlug ?? "default";
  const access = await resolveCatalogAccess({
    account: input.account,
    baseUrl: input.baseUrl,
  });
  const version = input.version ?? "latest";
  const selector = formatPublishedSelector({
    org: input.orgSlug,
    catalog: catalogSlug,
    name: input.layerSlug,
  });
  const inScope = isSelectorInCatalogScope(
    {
      orgSlug: input.orgSlug,
      catalogSlug,
      layerSlug: input.layerSlug,
    },
    access.scope,
  );

  if (!inScope && !access.isAuthenticated) {
    throw new Error(formatOutOfScopeMessage(selector));
  }

  const accountInfo = await getCloudAccount(input.account);
  const accessToken = accountInfo.account?.accessToken;
  if (accessToken) {
    const encodedVersion = encodeURIComponent(version);
    const url = catalogSlug === "default"
      ? `${access.scope.cloudBaseUrl}/api/catalog/${encodeURIComponent(input.orgSlug)}/${encodeURIComponent(input.layerSlug)}/versions/${encodedVersion}/layer-export`
      : `${access.scope.cloudBaseUrl}/api/catalog/${encodeURIComponent(input.orgSlug)}/${encodeURIComponent(catalogSlug)}/${encodeURIComponent(input.layerSlug)}/versions/${encodedVersion}/layer-export`;
    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (response.ok) {
      return { version, body: await response.text() };
    }
    if (response.status !== 404) {
      throw new Error(`Failed to download catalog layer export: ${response.status}`);
    }
  }

  if (!inScope) {
    throw new Error(formatOutOfScopeMessage(selector));
  }

  return access.publicClient.downloadBundle(
    input.orgSlug,
    input.layerSlug,
    version,
    catalogSlug,
  );
}

export async function validatePublicOrgHasLayers(orgSlug: string, baseUrl?: string): Promise<boolean> {
  const client = createPublicCatalogClient(resolveCatalogScope({ baseUrl }).cloudBaseUrl);
  const result = await client.listLayers({ orgs: [orgSlug], limit: 1 });
  return result.layers.length > 0;
}

export async function validatePublicLayerExists(
  selector: string,
  baseUrl?: string,
): Promise<boolean> {
  const client = createPublicCatalogClient(resolveCatalogScope({ baseUrl }).cloudBaseUrl);
  const result = await client.listLayers({ selectors: [selector], limit: 1 });
  const parsed = parseLayerSelector(selector);
  if (parsed.scope !== "published") {
    return false;
  }
  return result.layers.some((layer) =>
    layer.orgSlug === parsed.org
    && layer.catalogSlug === parsed.catalog
    && layer.slug === parsed.name,
  );
}
