import type {
  PluginMarketplaceEntry,
  PluginMarketplacePlatform,
} from "../types";
import { agentFetch, throwAgentError } from "./http";
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
