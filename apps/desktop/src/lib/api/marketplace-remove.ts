import type { PluginMarketplaceEntry } from "../types";
import { agentFetch, throwAgentError } from "./http";

export interface MarketplaceRemoveResult {
  status: "removed";
  entry: PluginMarketplaceEntry;
}

export async function removeMarketplace(
  baseUrl: string,
  token: string | null,
  name: string,
): Promise<MarketplaceRemoveResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/marketplaces/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not remove marketplace.");
  }
  return (await response.json()) as MarketplaceRemoveResult;
}
