import {
  formatOutOfScopeMessage,
  isSelectorInCatalogScope,
  resolveCatalogScope,
  type CatalogScope,
} from "../config/catalog.js";
import {
  ensureCloudAccountAccess,
  forceRefreshCloudAccountAccess,
} from "./cloud-account-auth.js";
import {
  isCatalogPluginInstallable,
  normalizeCatalogPlugin,
  type CatalogPlugin,
  type CatalogListOptions,
  type CatalogListResult,
} from "./catalog-types.js";
import {
  formatCanonicalPublishedSelector,
  formatPublishedSelector,
  parsePluginSelector,
} from "./plugin-selector.js";
import { throwIfCatalogPackageYanked } from "./catalog-package-errors.js";
import { parseApEnvelope } from "./agent-plugins/envelope.js";
import type { ApPackageFiles } from "./agent-plugins/files.js";
import { AP_PACKAGE_MEDIA_TYPE, cloudFetch } from "./cloud-api-version.js";
import { createPublicCatalogClient } from "./public-catalog-client.js";
import { rankCatalogSearchResults } from "./catalog-search-rank.js";
import { fetchWithTimeout, formatCatalogRequestError } from "../utils/fetch-with-timeout.js";

function buildScopeParams(scope: CatalogScope, options: CatalogListOptions): CatalogListOptions {
  return {
    ...options,
    orgs: options.orgs ?? scope.orgs,
    selectors: options.selectors ?? scope.selectors,
  };
}

function catalogPluginKey(plugin: Pick<CatalogPlugin, "orgSlug" | "catalogSlug" | "slug">): string {
  return `${plugin.orgSlug}/${plugin.catalogSlug}/${plugin.slug}`;
}

function dedupeCatalogPlugins(plugins: CatalogPlugin[]): CatalogPlugin[] {
  const byKey = new Map<string, CatalogPlugin>();
  const visibilityRank = { organization: 3, shared: 2, public: 1 } as const;
  for (const plugin of plugins) {
    const key = catalogPluginKey(plugin);
    const existing = byKey.get(key);
    if (!existing || visibilityRank[plugin.visibility] > visibilityRank[existing.visibility]) {
      byKey.set(key, plugin);
    }
  }
  return [...byKey.values()];
}

function sortCatalogPlugins(
  plugins: CatalogPlugin[],
  sort: "updated" | "name" = "updated",
): CatalogPlugin[] {
  const sorted = [...plugins];
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

export { CatalogPluginYankedError } from "./catalog-package-errors.js";

function normalizeListResult(result: CatalogListResult): CatalogListResult {
  return {
    ...result,
    plugins: result.plugins
      .map((plugin) => normalizeCatalogPlugin(plugin))
      .filter((plugin) => isCatalogPluginInstallable(plugin)),
  };
}

async function createAuthenticatedCatalogClient(baseUrl: string, accessToken: string) {
  const root = baseUrl.replace(/\/+$/, "");

  return {
    async listPlugins(options: CatalogListOptions = {}): Promise<CatalogListResult> {
      const params = new URLSearchParams();
      if (options.q?.trim()) params.set("q", options.q.trim());
      if (options.tag?.trim()) params.set("tag", options.tag.trim());
      if (options.catalog?.trim()) params.set("catalog", options.catalog.trim());
      if (options.limit != null) params.set("limit", String(options.limit));
      if (options.cursor) params.set("cursor", options.cursor);
      if (options.sort) params.set("sort", options.sort);
      for (const org of options.orgs ?? []) params.append("org", org);
      for (const selector of options.selectors ?? []) params.append("selector", selector);

      const listOnce = async (token: string) => {
        const response = await fetchWithTimeout(`${root}/api/catalog/plugins?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        return response;
      };

      let response = await listOnce(accessToken);
      if (response.status === 401) {
        const refreshed = await forceRefreshCloudAccountAccess();
        if (refreshed) {
          response = await listOnce(refreshed.accessToken);
        }
      }
      if (!response.ok) {
        throw new Error(`Failed to list catalog plugins: ${response.status}`);
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
  const ensured = await ensureCloudAccountAccess(input?.account);
  const accessToken = ensured?.accessToken;
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

export async function listCatalogPluginsPage(
  options: CatalogListOptions = {},
  input?: { account?: string; baseUrl?: string },
): Promise<CatalogListResult> {
  try {
    const access = await resolveCatalogAccess(input);
    const scopedOptions = buildScopeParams(access.scope, options);

    if (input?.account) {
      const ensured = await ensureCloudAccountAccess(input.account);
      if (ensured) {
        const client = await createAuthenticatedCatalogClient(
          access.scope.cloudBaseUrl,
          ensured.accessToken,
        );
        return await client.listPlugins(scopedOptions);
      }
      return await access.publicClient.listPlugins(scopedOptions);
    }

    if (access.authenticatedClient) {
      return await access.authenticatedClient.listPlugins(scopedOptions);
    }

    return await access.publicClient.listPlugins(scopedOptions);
  } catch (error) {
    throw new Error(formatCatalogRequestError(error), { cause: error });
  }
}

export async function fetchCatalogPlugin(
  plugin: Pick<CatalogPlugin, "orgSlug" | "catalogSlug" | "slug">,
  input?: { account?: string; baseUrl?: string },
): Promise<CatalogPlugin> {
  const key = catalogPluginKey(plugin);
  const selector = formatCanonicalPublishedSelector({
    org: plugin.orgSlug,
    catalog: plugin.catalogSlug,
    name: plugin.slug,
  });

  let cursor: string | null = null;
  do {
    const result = await listCatalogPluginsPage(
      {
        selectors: [selector],
        orgs: [plugin.orgSlug],
        catalog: plugin.catalogSlug,
        limit: 50,
        cursor,
      },
      input,
    );
    const found = result.plugins.find((candidate) => catalogPluginKey(candidate) === key);
    if (found) {
      return found;
    }
    cursor = result.nextCursor;
  } while (cursor);

  throw new Error(`Catalog plugin not found: ${key}`);
}

export async function listPluginsInScope(
  options: CatalogListOptions = {},
  input?: { account?: string; baseUrl?: string },
): Promise<CatalogPlugin[]> {
  const access = await resolveCatalogAccess(input);
  const scopedOptions = buildScopeParams(access.scope, options);

  if (access.authenticatedClient) {
    const result = await access.authenticatedClient.listPlugins(scopedOptions);
    return result.plugins;
  }

  const orgScopedPlugins: CatalogPlugin[] = [];
  const selectorsOnly = (scopedOptions.selectors ?? []).filter((selector) => {
    const parsed = parsePluginSelector(selector);
    if (parsed.scope !== "published") {
      return true;
    }
    return !scopedOptions.orgs?.includes(parsed.org);
  });

  if ((scopedOptions.orgs ?? []).length > 0) {
    const result = await access.publicClient.listPlugins({
      ...scopedOptions,
      selectors: [],
      limit: scopedOptions.limit ?? (scopedOptions.q?.trim() ? 25 : 10),
    });
    orgScopedPlugins.push(...result.plugins);
  }

  if (selectorsOnly.length > 0) {
    const result = await access.publicClient.listPlugins({
      ...scopedOptions,
      orgs: [],
      selectors: selectorsOnly,
      limit: scopedOptions.limit ?? (scopedOptions.q?.trim() ? 25 : 10),
    });
    orgScopedPlugins.push(...result.plugins);
  }

  const deduped = dedupeCatalogPlugins(orgScopedPlugins);
  const limit = scopedOptions.limit ?? (scopedOptions.q?.trim() ? 25 : 10);
  const ordered = scopedOptions.q?.trim()
    ? rankCatalogSearchResults(deduped, scopedOptions.q)
    : sortCatalogPlugins(deduped, scopedOptions.sort);
  return ordered.slice(0, limit);
}

export interface DownloadedPackage {
  version: string;
  files: ApPackageFiles;
}

export async function downloadCatalogPackage(input: {
  orgSlug: string;
  catalogSlug?: string;
  pluginSlug: string;
  version?: string;
  account?: string;
  baseUrl?: string;
}): Promise<DownloadedPackage> {
  const catalogSlug = input.catalogSlug ?? "default";
  const access = await resolveCatalogAccess({
    account: input.account,
    baseUrl: input.baseUrl,
  });
  const version = input.version ?? "latest";
  const selector = formatPublishedSelector({
    org: input.orgSlug,
    catalog: catalogSlug,
    name: input.pluginSlug,
  });
  const inScope = isSelectorInCatalogScope(
    {
      orgSlug: input.orgSlug,
      catalogSlug,
      pluginSlug: input.pluginSlug,
    },
    access.scope,
  );

  if (!inScope && !access.isAuthenticated) {
    throw new Error(formatOutOfScopeMessage(selector));
  }

  const ensured = await ensureCloudAccountAccess(input.account);
  const accessToken = ensured?.accessToken;
  if (accessToken) {
    const encodedVersion = encodeURIComponent(version);
    const url =
      `${access.scope.cloudBaseUrl}/api/catalog/${encodeURIComponent(input.orgSlug)}` +
      `/${encodeURIComponent(catalogSlug)}/${encodeURIComponent(input.pluginSlug)}` +
      `/versions/${encodedVersion}/package`;
    const downloadOnce = async (token: string) =>
      cloudFetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: AP_PACKAGE_MEDIA_TYPE,
        },
      });
    let response = await downloadOnce(accessToken);
    if (response.status === 401) {
      const refreshed = await forceRefreshCloudAccountAccess(input.account);
      if (refreshed) {
        response = await downloadOnce(refreshed.accessToken);
      }
    }
    await throwIfCatalogPackageYanked(response, `${input.orgSlug}/${catalogSlug}/${input.pluginSlug}@${version}`);
    if (response.ok) {
      return {
        version,
        files: parseApEnvelope(await response.text(), url),
      };
    }
    if (response.status !== 404) {
      throw new Error(
        `Failed to download ${input.orgSlug}/${catalogSlug}/${input.pluginSlug}: ${response.status}`,
      );
    }
  }

  if (!inScope) {
    throw new Error(formatOutOfScopeMessage(selector));
  }

  return access.publicClient.downloadPackage(
    input.orgSlug,
    input.pluginSlug,
    version,
    catalogSlug,
  );
}

export async function validatePublicOrgHasPlugins(orgSlug: string, baseUrl?: string): Promise<boolean> {
  const client = createPublicCatalogClient(resolveCatalogScope({ baseUrl }).cloudBaseUrl);
  const result = await client.listPlugins({ orgs: [orgSlug], limit: 1 });
  return result.plugins.length > 0;
}

export async function validatePublicPluginExists(
  selector: string,
  baseUrl?: string,
): Promise<boolean> {
  const client = createPublicCatalogClient(resolveCatalogScope({ baseUrl }).cloudBaseUrl);
  const result = await client.listPlugins({ selectors: [selector], limit: 1 });
  const parsed = parsePluginSelector(selector);
  if (parsed.scope !== "published") {
    return false;
  }
  return result.plugins.some((plugin) =>
    plugin.orgSlug === parsed.org
    && plugin.catalogSlug === parsed.catalog
    && plugin.slug === parsed.name,
  );
}
