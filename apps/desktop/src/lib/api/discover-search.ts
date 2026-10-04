import type { PluginOrigin } from "./library-plugins";
import { agentFetch, throwAgentError } from "./http";

export type DiscoverSearchHead = {
  name: string;
  version?: string;
  description: string | null;
  origin?: PluginOrigin;
  id: string;
  tags?: string[];
};

export type DiscoverSearchResource = {
  name: string;
  type: string;
  description: string | null;
  namespace: string | null;
  origin_kind?: string | null;
  id: string;
  tags?: string[];
};

export type DiscoverSearchMarketplacePlugin = {
  name: string;
  version?: string;
  description?: string;
  tags?: string[];
  contents?: unknown;
  ref: string;
};

export type DiscoverSearchGroup = {
  sourceId: string;
  sourceLabel: string;
  heads?: DiscoverSearchHead[];
  resources?: DiscoverSearchResource[];
  plugins?: DiscoverSearchMarketplacePlugin[];
};

export type DiscoverSearchResult = {
  groups: DiscoverSearchGroup[];
};

export async function fetchDiscoverSearch(
  baseUrl: string,
  token: string | null,
  input: { q?: string; sources?: string[]; signal?: AbortSignal } = {},
): Promise<DiscoverSearchResult> {
  const params = new URLSearchParams();
  const q = input.q?.trim();
  if (q) {
    params.set("q", q);
  }
  if (input.sources !== undefined) {
    params.set("sources", input.sources.join(","));
  }
  const qs = params.toString();
  const path = qs.length > 0 ? `/v1/discover/search?${qs}` : "/v1/discover/search";
  const response = await agentFetch(baseUrl, token, path, {
    signal: input.signal,
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not search Discover sources");
  }
  return (await response.json()) as DiscoverSearchResult;
}
