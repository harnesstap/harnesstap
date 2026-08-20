import type {
  PluginMarketplaceEntry,
  PluginMarketplacePlatform,
} from "../types";
import { AgentApiError, agentFetch, throwAgentError } from "./http";
import type { PublishCatalogRef } from "./publish";

export interface CatalogScope {
  defaultOrg: string;
  publicCatalog: boolean;
  connectedOrgs: string[];
  registered: PublishCatalogRef[];
}

export interface ConnectedOrgsResult {
  connectedOrgs: string[];
}

export interface PatchMarketplaceInput {
  name?: string;
  url?: string;
  platforms?: PluginMarketplacePlatform[];
}

export interface PatchMarketplaceResult {
  status: "updated";
  entry: PluginMarketplaceEntry;
  renamedFrom?: string;
  urlChanged: boolean;
  refresh?: { ok: boolean; message: string };
}

export async function fetchCatalogScope(
  baseUrl: string,
  token: string | null,
): Promise<CatalogScope> {
  const response = await agentFetch(baseUrl, token, "/v1/catalogs/scope");
  if (!response.ok) {
    return throwAgentError(response, "Could not load catalog sources");
  }
  return (await response.json()) as CatalogScope;
}

export async function connectCatalogOrgApi(
  baseUrl: string,
  token: string | null,
  org: string,
): Promise<ConnectedOrgsResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/catalogs/connected-orgs/${encodeURIComponent(org)}`,
    { method: "POST" },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not connect catalog org");
  }
  return (await response.json()) as ConnectedOrgsResult;
}

export async function disconnectCatalogOrgApi(
  baseUrl: string,
  token: string | null,
  org: string,
): Promise<ConnectedOrgsResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/catalogs/connected-orgs/${encodeURIComponent(org)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not disconnect catalog org");
  }
  return (await response.json()) as ConnectedOrgsResult;
}

export async function patchMarketplace(
  baseUrl: string,
  token: string | null,
  name: string,
  body: PatchMarketplaceInput,
): Promise<PatchMarketplaceResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/marketplaces/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not update marketplace");
  }
  return (await response.json()) as PatchMarketplaceResult;
}

export interface CatalogPluginSearchHit {
  selector: string;
  name: string;
  orgSlug: string;
  catalogSlug: string;
  version?: string;
  tags?: string[];
  description?: string | null;
}

export interface CatalogPluginSearchError {
  sourceLabel: string;
  message: string;
}

export interface CatalogPluginSearchResult {
  plugins: CatalogPluginSearchHit[];
  errors: CatalogPluginSearchError[];
}

export interface SourcePreviewFile {
  path: string;
  kind: "file";
}

export type SourcePreviewResult =
  | { files: SourcePreviewFile[] }
  | { path: string; content: string };

export function isCloudAuthError(error: unknown): boolean {
  return (
    error instanceof AgentApiError
    && (error.status === 401 || error.code === "auth_required")
  );
}

export function isCloudAuthMessage(message: string): boolean {
  return /\b401\b/.test(message) || message.includes("auth_required");
}

export async function searchCatalogPlugins(
  baseUrl: string,
  token: string | null,
  input: { q?: string; orgs: string[]; registered: string[] },
): Promise<CatalogPluginSearchResult> {
  const params = new URLSearchParams();
  const query = input.q?.trim();
  if (query) {
    params.set("q", query);
  }
  for (const org of input.orgs) {
    params.append("org", org);
  }
  for (const selector of input.registered) {
    params.append("registered", selector);
  }
  const qs = params.toString();
  const path = qs.length > 0 ? `/v1/catalogs/plugins?${qs}` : "/v1/catalogs/plugins";
  const response = await agentFetch(baseUrl, token, path);
  if (!response.ok) {
    return throwAgentError(response, "Could not search catalog plugins");
  }
  return (await response.json()) as CatalogPluginSearchResult;
}

export async function fetchMarketplacePluginPreview(
  baseUrl: string,
  token: string | null,
  marketplace: string,
  plugin: string,
  path?: string,
): Promise<SourcePreviewResult> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/marketplaces/${encodeURIComponent(marketplace)}/plugins/${encodeURIComponent(plugin)}/tree${query}`,
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not load marketplace plugin");
  }
  return (await response.json()) as SourcePreviewResult;
}

export async function fetchCatalogPluginPreview(
  baseUrl: string,
  token: string | null,
  selector: string,
  path?: string,
): Promise<SourcePreviewResult> {
  const params = new URLSearchParams();
  params.set("selector", selector);
  if (path) {
    params.set("path", path);
  }
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/catalogs/plugins/preview?${params.toString()}`,
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not preview catalog plugin");
  }
  return (await response.json()) as SourcePreviewResult;
}
