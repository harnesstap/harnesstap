import { agentFetch, throwAgentError } from "./http";

export type UpstreamStatus = "current" | "update" | "major" | "unreachable" | "unpublished";

export interface UpdateRow {
  plugin_name: string;
  ref: string;
  local_version: string;
  latest_in_range: string;
  latest_major: string;
  status: UpstreamStatus;
  checked_at: string;
  dismissed_version: string;
  message: string;
  kind: "extends" | "fork" | "catalog" | "unknown";
  pending: boolean;
  profiles: string[];
}

export interface UpdateList {
  rows: UpdateRow[];
  summary: { count: number; major_count: number };
}

export interface UpdateCheckJob {
  job_id: string;
  state: "running" | "done" | "failed";
  error?: string;
}

export async function fetchUpdates(baseUrl: string, token: string | null): Promise<UpdateList> {
  const response = await agentFetch(baseUrl, token, "/v1/updates");
  if (!response.ok) return throwAgentError(response, "Could not read updates");
  return (await response.json()) as UpdateList;
}

export async function startUpdateCheck(baseUrl: string, token: string | null): Promise<UpdateCheckJob> {
  const response = await agentFetch(baseUrl, token, "/v1/updates/check", { method: "POST" });
  if (!response.ok) return throwAgentError(response, "Could not start the update check");
  return (await response.json()) as UpdateCheckJob;
}

export async function fetchUpdateCheckJob(
  baseUrl: string,
  token: string | null,
  jobId: string,
): Promise<UpdateCheckJob> {
  const response = await agentFetch(baseUrl, token, `/v1/updates/check/${encodeURIComponent(jobId)}`);
  if (!response.ok) return throwAgentError(response, "Could not read the update check");
  return (await response.json()) as UpdateCheckJob;
}

export async function dismissUpdate(
  baseUrl: string,
  token: string | null,
  pluginName: string,
  version?: string,
): Promise<UpdateList> {
  const response = await agentFetch(baseUrl, token, `/v1/updates/${encodeURIComponent(pluginName)}/dismiss`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(version ? { version } : {}),
  });
  if (!response.ok) return throwAgentError(response, "Could not set the update aside");
  return (await response.json()) as UpdateList;
}
