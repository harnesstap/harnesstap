import { agentFetch, throwAgentError } from "./http";

export type PluginOriginCheckStatus =
  | "current"
  | "outdated"
  | "unknown"
  | "error";

export type PluginOriginCheckRow = {
  plugin_id: string;
  name: string;
  origin_locator: string;
  status: PluginOriginCheckStatus;
  local_version: string;
  origin_version?: string;
  origin_fingerprint?: string;
  message?: string;
};

export type PluginOriginCheckReport = { results: PluginOriginCheckRow[] };

export type PluginOriginUpdateStatus = "updated" | "skipped" | "failed";

export type PluginOriginUpdateRow = {
  plugin_id: string;
  name: string;
  status: PluginOriginUpdateStatus;
  message?: string;
  local_version?: string;
};

export type PluginOriginUpdateReport = {
  results: PluginOriginUpdateRow[];
  summary: { updated: number; skipped: number; failed: number };
};

export async function fetchPluginOriginCheck(
  baseUrl: string,
  token: string | null,
  input: { refresh?: boolean } = {},
): Promise<PluginOriginCheckReport> {
  const path = input.refresh
    ? "/v1/plugins/check?refresh=1"
    : "/v1/plugins/check";
  const response = await agentFetch(baseUrl, token, path);
  if (!response.ok) {
    return throwAgentError(response, "Could not check plugins against origin");
  }
  return (await response.json()) as PluginOriginCheckReport;
}

export async function postPluginOriginUpdate(
  baseUrl: string,
  token: string | null,
  input: { name?: string; all?: boolean; force?: boolean },
): Promise<PluginOriginUpdateReport> {
  const response = await agentFetch(baseUrl, token, "/v1/plugins/update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...(input.name ? { name: input.name } : {}),
      ...(input.all ? { all: true } : {}),
      ...(input.force ? { force: true } : {}),
    }),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not update plugins from origin");
  }
  return (await response.json()) as PluginOriginUpdateReport;
}
